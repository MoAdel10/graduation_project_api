const pool = require("../DB").promise(); // Assumes mysql2 pool with promise wrapper
require("dotenv").config();
const crypto = require("crypto");
const _ = require("underscore");
const queryString = require("query-string").default || require("query-string");
const {
  KashierPaymentService,
} = require("../Utils/classes/KashierPaymentService");

const GetPaymentLink = async (req, res) => {
  const { request_id, invoice_id, subscription_id, redirect } = req.body;
  const kashier = new KashierPaymentService(
    process.env.PAYMENT_SEC_KEY,
    process.env.PAYMENT_API_KEY,
    process.env.PAYMENT_MERCHENT_ID,
    redirect,
    `http://${process.env.URL}/payment/webhook`,
  );

  let sql, params;

  if (invoice_id) {
    sql = `SELECT i.amount as total_price, i.invoice_id as id, u.email FROM invoices i 
           JOIN users u ON i.renter_id = u.user_id WHERE i.invoice_id = ? AND i.status = 'UNPAID'`;
    params = [invoice_id];
  } else if (subscription_id) {
    sql = `SELECT ls.amount as total_price, ls.subscription_id as id, u.email FROM listingsubscriptions ls 
           JOIN users u ON ls.owner_id = u.user_id WHERE ls.subscription_id = ? AND ls.status = 'UNPAID'`;
    params = [subscription_id];
  } else {
    sql = `SELECT rr.total_price, rr.request_id as id, u.email FROM renting_request rr 
           JOIN users u ON rr.renter_id = u.user_id WHERE rr.request_id = ? AND rr.request_state != 'PAID'`;
    params = [request_id];
  }

  try {
    const [rows] = await pool.query(sql, params);
    if (!rows || rows.length === 0) {
      return res
        .status(404)
        .json({ msg: "Payment target not found or already paid" });
    }
    const target = rows[0];

    const customer = { email: target.email, reference: String(target.id) };
    const sessionPayload = kashier.createPaymentSession(
      parseFloat(target.total_price),
      customer,
      "EGP",
      target.id,
    );
    const kashierResponse = await kashier.sendPaymentRequest(sessionPayload);

    if (kashierResponse?.sessionUrl) {
      return res.status(200).json({ url: kashierResponse.sessionUrl });
    }
    throw new Error("Kashier did not return a session URL");
  } catch (error) {
    console.error("Payment Link Generation Error: ", error);
    return res.status(500).json({ msg: "Payment initiation failed" });
  }
};

const KashierWebhook = async (req, res) => {
  const { data, event } = req.body;
  if (event !== "pay") return res.status(200).send("OK");

  try {
    // --- Signature Verification ---
    const signatureKeys = data.signatureKeys.sort();
    const objectSignaturePayload = _.pick(data, signatureKeys);
    const signaturePayload = queryString.stringify(objectSignaturePayload);

    const generatedSignature = crypto
      .createHmac("sha256", process.env.PAYMENT_API_KEY)
      .update(signaturePayload)
      .digest("hex");

    if (generatedSignature !== req.header("x-kashier-signature")) {
      console.error("❌ Invalid Webhook Signature!");
      return res.status(400).send("Invalid Signature");
    }

    if (data.status !== "SUCCESS") {
      return res.status(200).send("OK");
    }

    const orderId = data.merchantOrderId;
    const notifier = req.app.get("notifier");

    // ==========================================
    // --- SCENARIO A: MONTHLY RENT PAYMENT ---
    // ==========================================
    const [invRows] = await pool.query(
      "SELECT * FROM invoices WHERE invoice_id = ?",
      [orderId],
    );
    if (invRows.length > 0) {
      const invoice = invRows[0];
      if (invoice.status === "PAID") return res.status(200).send("OK");

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        // Safe precision math for commission and earnings
        const totalPrice = parseFloat(invoice.amount);
        const commission = parseFloat((totalPrice * 0.02).toFixed(2));
        const ownerEarnings = totalPrice - commission;

        // 1. Update Invoice Status
        await connection.query(
          `UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, kashier_order_id = ? WHERE invoice_id = ?`,
          [data.transactionId, orderId],
        );

        // 2. ATOMICALLY ADD TO LANDLORD'S BALANCE FOR LATER MONTHS 💰
        await connection.query(
          `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
          [ownerEarnings, invoice.owner_id],
        );

        // 3. Log the Payment Intent
        await connection.query(
          `INSERT INTO paymentintents (payment_id, user_id, payment_type, value, payment_method, status)
           VALUES (?, ?, 'rent_monthly', ?, ?, 'succeeded')`,
          [
            data.transactionId,
            invoice.renter_id,
            totalPrice,
            data.paymentMethod || "card",
          ],
        );

        await connection.commit();

        notifier.send({
          receiver: invoice.renter_id,
          type: "MONTHLY_RENT_PAID",
          title: "Rent Paid Successfully ✅",
          body: `Your monthly rent payment of ${invoice.amount} EGP was received.`,
          metadata: { invoice_id: orderId, transaction_id: data.transactionId },
        });

        notifier.send({
          receiver: invoice.owner_id,
          type: "MONTHLY_RENT_RECEIVED",
          title: "Rent Payment Received! 💰",
          body: `You received ${ownerEarnings} EGP for invoice #${orderId} (after platform fee).`,
          metadata: { invoice_id: orderId },
        });
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }
      return res.status(200).send("OK");
    }

    // ==========================================
    // --- SCENARIO C: LISTING SUBSCRIPTION ---
    // ==========================================
    const [subRows] = await pool.query(
      "SELECT * FROM listingsubscriptions WHERE subscription_id = ?",
      [orderId],
    );
    if (subRows.length > 0) {
      const sub = subRows[0];
      if (sub.status === "PAID") return res.status(200).send("OK");

      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        await connection.query(
          `UPDATE listingsubscriptions SET status = 'PAID', kashier_order_id = ? WHERE subscription_id = ?`,
          [data.transactionId, orderId],
        );

        await connection.query(
          `UPDATE property SET listing_status = 'active', listing_expiry = DATE_ADD(CURDATE(), INTERVAL ? MONTH) WHERE property_id = ?`,
          [sub.plan_months, sub.property_id],
        );

        await connection.commit();

        notifier.send({
          receiver: sub.owner_id,
          type: "LISTING_FEE_PAID",
          title: "Property Listing Active! 🎉",
          body: `Your property listing fee of ${sub.amount} EGP was received. It will be active for ${sub.plan_months} months.`,
          metadata: { subscription_id: orderId, property_id: sub.property_id },
        });
      } catch (txErr) {
        await connection.rollback();
        throw txErr;
      } finally {
        connection.release();
      }
      return res.status(200).send("OK");
    }

    // ==========================================================
    // --- SCENARIO B: INITIAL RENT REQUEST (LEASE GRADUATION) ---
    // ==========================================================
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `SELECT rr.*, p.owner_id, p.property_name 
         FROM renting_request rr
         JOIN property p ON rr.property_id = p.property_id
         WHERE rr.request_id = ? FOR UPDATE`,
        [orderId],
      );

      if (rows.length === 0) {
        await connection.rollback();
        return res.status(404).send("Target Request Not Found");
      }

      const requestDetails = rows[0];
      if (requestDetails.request_state === "PAID") {
        await connection.rollback();
        return res.status(200).send("OK");
      }

      const totalPrice = parseFloat(requestDetails.total_price);
      const commission = parseFloat((totalPrice * 0.02).toFixed(2));
      const ownerEarnings = totalPrice - commission;

      // 1. Update Request State
      await connection.query(
        `UPDATE renting_request SET request_state = 'PAID', payment_id = ? WHERE request_id = ?`,
        [data.transactionId, orderId],
      );

      // 2. Pay the Landlord (First Month) 💰
      await connection.query(
        `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
        [ownerEarnings, requestDetails.owner_id],
      );

      // 3. Create the Actual Lease
      const leaseId = crypto.randomUUID();
      let nextBillingDate = null;
      if (requestDetails.renting_type === "MONTH") {
        const nextBilling = new Date(requestDetails.check_in_date);
        nextBilling.setMonth(nextBilling.getMonth() + 1);
        nextBillingDate = nextBilling.toISOString().slice(0, 10);
      }

      await connection.query(
        `INSERT INTO lease (lease_id, request_id, renter_id, owner_id, property_id, renting_type, status, check_in_date, check_out_date, next_billing_date)
         VALUES (?, ?, ?, ?, ?, ?, 'UPCOMING', ?, ?, ?)`,
        [
          leaseId,
          orderId,
          requestDetails.renter_id,
          requestDetails.owner_id,
          requestDetails.property_id,
          requestDetails.renting_type,
          requestDetails.check_in_date,
          requestDetails.check_out_date,
          nextBillingDate,
        ],
      );

      // 4. Log the Payment Intent
      await connection.query(
        `INSERT INTO paymentintents (payment_id, user_id, property_id, payment_type, value, payment_method, status)
         VALUES (?, ?, ?, 'rent', ?, ?, 'succeeded')`,
        [
          data.transactionId,
          requestDetails.renter_id,
          requestDetails.property_id,
          totalPrice,
          data.paymentMethod || "card",
        ],
      );

      await connection.commit();

      notifier.send({
        receiver: requestDetails.renter_id,
        type: "PAYMENT_SUCCESS",
        title: "Lease Confirmed! 🎉",
        body: `Your booking for "${requestDetails.property_name}" is now confirmed.`,
        metadata: { request_id: orderId },
      });

      notifier.send({
        receiver: requestDetails.owner_id,
        type: "RENT_PAID",
        title: "New Booking! 💰",
        body: `A renter has paid for "${requestDetails.property_name}".`,
        metadata: { request_id: orderId },
      });
    } catch (txErr) {
      await connection.rollback();
      throw txErr;
    } finally {
      connection.release();
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Webhook Handling Failure Error:", error);
    return res.status(500).send("Internal Processing Failure");
  }
};

const refundPayment = async (req, res) => {
  const { request_id, reason } = req.body;
  if (!request_id)
    return res.status(400).json({ msg: "Request ID is required" });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [results] = await connection.query(
      "SELECT * FROM renting_request WHERE request_id = ? FOR UPDATE",
      [request_id],
    );

    if (results.length === 0) {
      await connection.rollback();
      return res.status(404).json({ msg: "Renting request not found" });
    }

    const rentRequest = results[0];
    if (rentRequest.request_state !== "PAID") {
      await connection.rollback();
      return res
        .status(400)
        .json({ msg: "Refunds are only possible for paid requests." });
    }

    await connection.query(
      "UPDATE renting_request SET request_state = 'REFUND_PROCESSING' WHERE request_id = ?",
      [request_id],
    );
    await connection.commit();

    const kashier = new KashierPaymentService(
      process.env.PAYMENT_SEC_KEY,
      process.env.PAYMENT_API_KEY,
    );
    const refundResponse = await kashier.sendRefundRequest(
      rentRequest.total_price,
      rentRequest.payment_id,
      reason || "Owner requested refund",
    );

    if (refundResponse && refundResponse.status === "SUCCESS") {
      await pool.query(
        "UPDATE renting_request SET request_state = 'REFUNDED' WHERE request_id = ?",
        [request_id],
      );

      const paymentIntentId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO paymentintents (payment_id, user_id, property_id, payment_type, value, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentIntentId,
          rentRequest.renter_id,
          rentRequest.property_id,
          "refund",
          rentRequest.total_price,
          "card",
          "succeeded",
        ],
      );

      req.app.get("notifier").send({
        receiver: rentRequest.renter_id,
        type: "PAYMENT_REFUNDED",
        title: "Refund Processed 🔄",
        body: `A refund of ${rentRequest.total_price} EGP has been issued for your request.`,
        metadata: { request_id, amount: rentRequest.total_price },
      });

      return res.status(200).json({ msg: "Refund processed successfully." });
    } else {
      await pool.query(
        "UPDATE renting_request SET request_state = 'PAID' WHERE request_id = ?",
        [request_id],
      );
      return res
        .status(500)
        .json({
          msg: "Refund failed at payment gateway.",
          details: refundResponse?.message,
        });
    }
  } catch (error) {
    console.error("Refund Error: ", error);
    return res
      .status(500)
      .json({ msg: "An unexpected error occurred during the refund process." });
  } finally {
    connection.release();
  }
};

const requestWithdrawal = async (req, res) => {
  const { amount, method, receiverData } = req.body;
  const userId = req.user.userId;
  if (!amount || !method || !receiverData) {
    return res
      .status(400)
      .json({ msg: "Amount, method, and receiver data are required." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [results] = await connection.query(
      "SELECT balance FROM users WHERE user_id = ? FOR UPDATE",
      [userId],
    );
    if (results.length === 0) {
      await connection.rollback();
      return res.status(404).json({ msg: "User not found." });
    }

    const balance = results[0].balance;
    if (balance < amount) {
      await connection.rollback();
      return res.status(400).json({ msg: "Insufficient balance." });
    }

    const newBalance = balance - amount;
    await connection.query("UPDATE users SET balance = ? WHERE user_id = ?", [
      newBalance,
      userId,
    ]);

    const paymentIntentId = crypto.randomUUID();
    await connection.query(
      `INSERT INTO paymentintents (payment_id, user_id, payment_type, value, payment_method, status) VALUES (?, ?, 'withdraw', ?, ?, 'pending')`,
      [paymentIntentId, userId, amount, method],
    );

    await connection.commit();

    const kashier = new KashierPaymentService(process.env.PAYMENT_SEC_KEY);
    const withdrawalResponse = await kashier.sendMoney(
      amount,
      method,
      receiverData,
    );

    if (withdrawalResponse && withdrawalResponse.status === "SUCCESS") {
      await pool.query(
        "UPDATE paymentintents SET status = 'succeeded' WHERE payment_id = ?",
        [paymentIntentId],
      );

      req.app.get("notifier").send({
        receiver: userId,
        type: "WITHDRAWAL_SUCCESS",
        title: "Withdrawal Complete 🏦",
        body: `Your withdrawal of ${amount} EGP via ${method} was successful.`,
        metadata: { amount, method },
      });
      return res.status(200).json({ msg: "Withdrawal successful." });
    } else {
      await pool.query(
        "UPDATE users SET balance = balance + ? WHERE user_id = ?",
        [amount, userId],
      );
      await pool.query(
        "UPDATE paymentintents SET status = 'failed' WHERE payment_id = ?",
        [paymentIntentId],
      );
      return res
        .status(500)
        .json({
          msg: "Withdrawal failed at payment gateway.",
          details: withdrawalResponse?.message,
        });
    }
  } catch (error) {
    console.error("Withdrawal Error: ", error);
    return res
      .status(500)
      .json({
        msg: "An unexpected error occurred during the withdrawal process.",
      });
  } finally {
    connection.release();
  }
};

const getUserBalance = async (req, res) => {
  const userId = req.user.userId; // Assumes your authentication middleware populates req.user

  try {
    // Fetch the balance directly from the database
    const [rows] = await pool.query(
      "SELECT balance FROM users WHERE user_id = ?",
      [userId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Return the balance formatted to 2 decimal places safely
    const userBalance = parseFloat(rows[0].balance).toFixed(2);

    return res.status(200).json({
      success: true,
      balance: userBalance,
      currency: "EGP",
    });
  } catch (error) {
    console.error("Error fetching user balance:", error);
    return res.status(500).json({ msg: "Failed to retrieve account balance" });
  }
};

module.exports = {
  GetPaymentLink,
  KashierWebhook,
  refundPayment,
  requestWithdrawal,
  getUserBalance,
};
