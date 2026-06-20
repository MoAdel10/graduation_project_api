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

      const invConn = await pool.getConnection();
      try {
        await invConn.beginTransaction();

        // Safe precision math for commission and earnings
        const totalPrice = parseFloat(invoice.amount);
        const commission = parseFloat((totalPrice * 0.02).toFixed(2));
        const ownerEarnings = totalPrice - commission;

        // 1. Update Invoice Status
        await invConn.query(
          `UPDATE invoices SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, kashier_order_id = ? WHERE invoice_id = ?`,
          [data.transactionId, orderId],
        );

        // 2. ATOMICALLY ADD TO LANDLORD'S BALANCE FOR LATER MONTHS 💰
        await invConn.query(
          `UPDATE users SET balance = balance + ? WHERE user_id = ?`,
          [ownerEarnings, invoice.owner_id],
        );

        // 3. Log the Payment Intent
        await invConn.query(
          `INSERT INTO paymentintents (payment_id, user_id, payment_type, value, payment_method, status)
           VALUES (?, ?, 'rent', ?, ?, 'succeeded')`,
          [
            data.transactionId,
            invoice.renter_id,
            totalPrice,
            data.paymentMethod || "card",
          ],
        );

        await invConn.commit();

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
        await invConn.rollback();
        throw txErr;
      } finally {
        invConn.release();
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

      const subConn = await pool.getConnection();
      try {
        await subConn.beginTransaction();

        await subConn.query(
          `UPDATE listingsubscriptions SET status = 'PAID', kashier_order_id = ? WHERE subscription_id = ?`,
          [data.transactionId, orderId],
        );

        await subConn.query(
          `UPDATE property SET listing_status = 'active', listing_expiry = DATE_ADD(CURDATE(), INTERVAL ? MONTH) WHERE property_id = ?`,
          [sub.plan_months, sub.property_id],
        );

        await subConn.commit();

        notifier.send({
          receiver: sub.owner_id,
          type: "LISTING_FEE_PAID",
          title: "Property Listing Active! 🎉",
          body: `Your property listing fee of ${sub.amount} EGP was received. It will be active for ${sub.plan_months} months.`,
          metadata: { subscription_id: orderId, property_id: sub.property_id },
        });
      } catch (txErr) {
        await subConn.rollback();
        throw txErr;
      } finally {
        subConn.release();
      }
      return res.status(200).send("OK");
    }

    // ==========================================================
    // --- SCENARIO B: INITIAL RENT REQUEST (LEASE GRADUATION) ---
    // ==========================================================
    const rentConn = await pool.getConnection();
    try {
      await rentConn.beginTransaction();

      const [rows] = await rentConn.query(
        `SELECT rr.*, p.owner_id, p.property_name 
         FROM renting_request rr
         JOIN property p ON rr.property_id = p.property_id
         WHERE rr.request_id = ? FOR UPDATE`,
        [orderId],
      );

      if (rows.length === 0) {
        await rentConn.rollback();
        return res.status(404).send("Target Request Not Found");
      }

      const requestDetails = rows[0];
      if (requestDetails.request_state === "PAID") {
        await rentConn.rollback();
        return res.status(200).send("OK");
      }

      const totalPrice = parseFloat(requestDetails.total_price);
      const commission = parseFloat((totalPrice * 0.02).toFixed(2));
      const ownerEarnings = totalPrice - commission;

      // 1. Update Request State
      await rentConn.query(
        `UPDATE renting_request SET request_state = 'PAID', payment_id = ? WHERE request_id = ?`,
        [data.transactionId, orderId],
      );

      // 2. Pay the Landlord (First Month) 💰
      await rentConn.query(
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

      await rentConn.query(
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
      await rentConn.query(
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

      await rentConn.commit();

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
      await rentConn.rollback();
      throw txErr;
    } finally {
      rentConn.release();
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

  let conn;
  try {
    conn = await pool.getConnection();

    // ── Phase 1: Validate + Lock ──
    await conn.beginTransaction();

    const [results] = await conn.query(
      "SELECT * FROM renting_request WHERE request_id = ? FOR UPDATE",
      [request_id],
    );

    if (results.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Renting request not found" });
    }

    const rentRequest = results[0];
    if (rentRequest.request_state !== "PAID") {
      await conn.rollback();
      return res
        .status(400)
        .json({ msg: "Refunds are only possible for paid requests." });
    }

    if (new Date(rentRequest.check_in_date) <= new Date()) {
      await conn.rollback();
      return res
        .status(400)
        .json({ msg: "Refunds are not allowed on or after the check-in date." });
    }

    await conn.query(
      "UPDATE renting_request SET request_state = 'REFUND_PROCESSING' WHERE request_id = ?",
      [request_id],
    );
    await conn.commit();

    // ── Phase 2: Contact Payment Gateway ──
    const kashier = new KashierPaymentService(
      process.env.PAYMENT_SEC_KEY,
      process.env.PAYMENT_API_KEY,
    );
    const refundResponse = await kashier.sendRefundRequest(
      rentRequest.total_price,
      rentRequest.request_id,
      reason || "Owner requested refund",
    );

    if (refundResponse && refundResponse.status === "SUCCESS") {
      // ── Phase 3: Finalize Refund (atomic) ──
      await conn.beginTransaction();

      const totalPrice = parseFloat(rentRequest.total_price);
      const commission = parseFloat((totalPrice * 0.02).toFixed(2));
      const ownerEarnings = totalPrice - commission;

      await conn.query(
        "UPDATE renting_request SET request_state = 'REFUNDED' WHERE request_id = ?",
        [request_id],
      );

      await conn.query(
        "UPDATE users SET balance = GREATEST(balance - ?, 0) WHERE user_id = ?",
        [ownerEarnings, rentRequest.owner_id],
      );

      await conn.query(
        "UPDATE lease SET status = 'CANCELLED' WHERE request_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED')",
        [request_id],
      );

      await conn.query(
        "UPDATE property SET is_available = TRUE WHERE property_id = ?",
        [rentRequest.property_id],
      );

      const paymentIntentId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO paymentintents (payment_id, user_id, property_id, payment_type, value, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          paymentIntentId,
          rentRequest.renter_id,
          rentRequest.property_id,
          "refund",
          totalPrice,
          "card",
          "succeeded",
        ],
      );

      await conn.commit();

      // ── Phase 4: Notifications ──
      const notifier = req.app.get("notifier");

      notifier.send({
        receiver: rentRequest.renter_id,
        type: "PAYMENT_REFUNDED",
        title: "Refund Processed 🔄",
        body: `A refund of ${totalPrice} EGP has been issued for your request.`,
        metadata: { request_id, amount: totalPrice },
      });

      notifier.send({
        receiver: rentRequest.owner_id,
        type: "BOOKING_CANCELLED",
        title: "Booking Cancelled 🔄",
        body: `A booking has been cancelled and refunded. Your balance has been adjusted and the property is now available for new renters.`,
        metadata: { request_id, property_id: rentRequest.property_id },
      });

      return res.status(200).json({ msg: "Refund processed successfully." });
    } else {
      await conn.query(
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
    if (conn) conn.release();
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

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [results] = await conn.query(
      "SELECT balance, first_name, second_name FROM users WHERE user_id = ? FOR UPDATE",
      [userId],
    );
    if (results.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "User not found." });
    }

    const balance = results[0].balance;
    const recipientName = `${results[0].first_name || ""} ${results[0].second_name || ""}`.trim() || "Account Holder";
    if (balance < amount) {
      await conn.rollback();
      return res.status(400).json({ msg: "Insufficient balance." });
    }

    const newBalance = balance - amount;
    await conn.query("UPDATE users SET balance = ? WHERE user_id = ?", [
      newBalance,
      userId,
    ]);

    const paymentIntentId = crypto.randomUUID();
    await conn.query(
      `INSERT INTO paymentintents (payment_id, user_id, property_id, payment_type, value, payment_method, status) VALUES (?, ?, NULL, 'withdraw', ?, ?, 'pending')`,
      [paymentIntentId, userId, amount, method],
    );

    await conn.commit();

    // ── Kashier Gateway Payout Call (wrapped in dedicated try/catch) ──────
    let withdrawalResponse;
    let kashier;
    try {
      kashier = new KashierPaymentService(process.env.PAYMENT_SEC_KEY);
      withdrawalResponse = await kashier.sendMoney(
        amount,
        method,
        receiverData,
        recipientName,
      );

      console.log("Kashier withdrawal response:", withdrawalResponse);
    } catch (gatewayError) {
      // sendMoney threw — revert balance and payment intent
      await pool.query(
        "UPDATE users SET balance = balance + ? WHERE user_id = ?",
        [amount, userId],
      );
      await pool.query(
        "UPDATE paymentintents SET status = 'failed' WHERE payment_id = ?",
        [paymentIntentId],
      );

      const errorMsg =
        gatewayError instanceof Error
          ? gatewayError.message
          : "Gateway returned an unexpected error.";
      console.error("Kashier payout error:", errorMsg);
      return res.status(502).json({ msg: errorMsg });
    }

    const transferStatus = withdrawalResponse?.data?.[0]?.status;
    if (transferStatus !== "SUCCESS" && transferStatus !== "PENDING") {
      await pool.query(
        "UPDATE users SET balance = balance + ? WHERE user_id = ?",
        [amount, userId],
      );
      await pool.query(
        "UPDATE paymentintents SET status = 'failed' WHERE payment_id = ?",
        [paymentIntentId],
      );

      const gatewayMsg =
        withdrawalResponse?.message || "Gateway did not return a success status.";
      return res
        .status(502)
        .json({
          msg: "Withdrawal failed at payment gateway.",
          details: gatewayMsg,
        });
    }

    // ── Verify with a short poll — Kashier may accept then instantly fail ──
    const transferId = withdrawalResponse.data[0].transferId;
    let verified = transferStatus;
    if (transferStatus === "PENDING") {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const poll = await kashier.getTransferStatus(transferId);
        const pollStatus = poll?.data?.[0]?.status ?? poll?.status;
        if (pollStatus === "FAILED" || pollStatus === "REJECTED") {
          verified = "FAILED";
        }
      } catch {
        // poll failed — trust original PENDING
      }
    }

    if (verified === "FAILED") {
      await pool.query(
        "UPDATE users SET balance = balance + ? WHERE user_id = ?",
        [amount, userId],
      );
      await pool.query(
        "UPDATE paymentintents SET status = 'failed' WHERE payment_id = ?",
        [paymentIntentId],
      );
      return res.status(502).json({ msg: "Withdrawal rejected by payment gateway." });
    }

    // Confirm — save transfer_id, update status, notify
    const intentStatus = verified === "SUCCESS" ? "succeeded" : "pending";
    await pool.query(
      "UPDATE paymentintents SET status = ?, transfer_id = ? WHERE payment_id = ?",
      [intentStatus, transferId, paymentIntentId],
    );

    req.app.get("notifier").send({
      receiver: userId,
      type: "WITHDRAWAL_SUCCESS",
      title: "Withdrawal Complete 🏦",
      body: `Your withdrawal of ${amount} EGP via ${method} was successful.`,
      metadata: { amount, method },
    });
    return res.status(200).json({ msg: "Withdrawal submitted successfully.", transferId });
  } catch (error) {
    console.error("Withdrawal Error: ", error);
    return res
      .status(500)
      .json({
        msg: "An unexpected error occurred during the withdrawal process.",
      });
  } finally {
    if (conn) conn.release();
  }
};

const getUserBalance = async (req, res) => {
  const userId = req.user.userId;

  try {
    const [rows] = await pool.query(
      "SELECT balance FROM users WHERE user_id = ?",
      [userId],
    );

    if (rows.length === 0) {
      return res.status(404).json({ msg: "User not found" });
    }

    const balance = parseFloat(rows[0].balance);

    // Calculate locked funds from future rentals (owner's earnings already credited)
    const [lockedRows] = await pool.query(
      `SELECT COALESCE(SUM(rr.total_price * 0.98), 0) AS locked_funds
       FROM renting_request rr
       JOIN property p ON rr.property_id = p.property_id
       WHERE p.owner_id = ?
         AND rr.request_state = 'PAID'
         AND rr.check_in_date > CURDATE()`,
      [userId],
    );

    const lockedFunds = parseFloat(lockedRows[0].locked_funds);
    const availableBalance = Math.max(balance - lockedFunds, 0);

    return res.status(200).json({
      success: true,
      balance: balance.toFixed(2),
      lockedFunds: lockedFunds.toFixed(2),
      availableBalance: availableBalance.toFixed(2),
      currency: "EGP",
    });
  } catch (error) {
    console.error("Error fetching user balance:", error);
    return res.status(500).json({ msg: "Failed to retrieve account balance" });
  }
};

const getTransactionHistory = async (req, res) => {
  const userId = req.user.userId;

  try {
    const [rows] = await pool.query(
      `SELECT payment_id, property_id, payment_type, value, payment_method, status, transfer_id, created_at
       FROM paymentintents
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );

    res.status(200).json({ success: true, transactions: rows });
  } catch (error) {
    console.error("Transaction History Error:", error);
    res.status(500).json({ msg: "Failed to retrieve transaction history" });
  }
};

const requestRefund = async (req, res) => {
  const { request_id, reason } = req.body;
  if (!request_id)
    return res.status(400).json({ msg: "Request ID is required" });

  try {
    const [rows] = await pool.query(
      "SELECT * FROM renting_request WHERE request_id = ? AND renter_id = ?",
      [request_id, req.user.userId],
    );

    if (rows.length === 0)
      return res.status(404).json({ msg: "Rent request not found" });

    const rentRequest = rows[0];
    if (rentRequest.request_state !== "PAID")
      return res
        .status(400)
        .json({ msg: "Refunds can only be requested for paid requests." });

    if (rentRequest.denied_at)
      return res
        .status(400)
        .json({ msg: "Refund was already denied by the admin." });

    await pool.query(
      "UPDATE renting_request SET request_state = 'REFUND_REQUESTED', reason = ? WHERE request_id = ?",
      [reason || null, request_id],
    );

    res.status(200).json({ msg: "Refund request submitted. An admin will review it." });
  } catch (error) {
    console.error("requestRefund Error:", error);
    res.status(500).json({ msg: "An unexpected error occurred." });
  }
};

const cancelRefundRequest = async (req, res) => {
  const { request_id } = req.body;
  if (!request_id)
    return res.status(400).json({ msg: "Request ID is required" });

  try {
    const [rows] = await pool.query(
      "SELECT * FROM renting_request WHERE request_id = ? AND renter_id = ?",
      [request_id, req.user.userId],
    );

    if (rows.length === 0)
      return res.status(404).json({ msg: "Rent request not found" });

    const rentRequest = rows[0];
    if (rentRequest.request_state !== "REFUND_REQUESTED")
      return res
        .status(400)
        .json({ msg: "Only active refund requests can be cancelled." });

    await pool.query(
      "UPDATE renting_request SET request_state = 'PAID', denied_at = NULL WHERE request_id = ?",
      [request_id],
    );

    res.status(200).json({ msg: "Refund request cancelled. Payment remains valid." });
  } catch (error) {
    console.error("cancelRefundRequest Error:", error);
    res.status(500).json({ msg: "An unexpected error occurred." });
  }
};

const getTransferStatus = async (req, res) => {
  const { transferId } = req.params;
  if (!transferId)
    return res.status(400).json({ msg: "Transfer ID is required" });

  try {
    const kashier = new KashierPaymentService(process.env.PAYMENT_SEC_KEY);
    const status = await kashier.getTransferStatus(transferId);
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    console.error("getTransferStatus Error:", error);
    res.status(500).json({ msg: "Failed to retrieve transfer status" });
  }
};

module.exports = {
  GetPaymentLink,
  KashierWebhook,
  refundPayment,
  requestWithdrawal,
  getUserBalance,
  getTransactionHistory,
  requestRefund,
  cancelRefundRequest,
  getTransferStatus,
};
