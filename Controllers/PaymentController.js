const connection = require("../DB");
require("dotenv").config();
const crypto = require("crypto");
const _ = require("underscore");
const queryString = require("query-string").default || require("query-string");
const {
  KashierPaymentService,
} = require("../Utils/classes/KashierPaymentService");

const GetPaymentLink = async (req, res) => {
  const { request_id, invoice_id, redirect } = req.body;
  const kashier = new KashierPaymentService(
    process.env.PAYMENT_SEC_KEY,
    process.env.PAYMENT_API_KEY,
    process.env.PAYMENT_MERCHENT_ID,
    redirect,
    `http://${process.env.URL}/payment/webhook`,
  );

  let sql, params, idToUse;

  // Decide if we are paying a NEW request or a MONTHLY invoice
  if (invoice_id) {
    sql = `SELECT i.amount as total_price, i.invoice_id as id, u.email FROM Invoices i 
           JOIN Users u ON i.renter_id = u.user_id WHERE i.invoice_id = ? AND i.status = 'UNPAID'`;
    params = [invoice_id];
    idToUse = invoice_id;
  } else {
    sql = `SELECT rr.total_price, rr.request_id as id, u.email FROM renting_request rr 
           JOIN Users u ON rr.renter_id = u.user_id WHERE rr.request_id = ?`;
    params = [request_id];
    idToUse = request_id;
  }

  connection.query(sql, params, async (err, result) => {
    if (err || result.length === 0)
      return res.status(404).json({ msg: "Payment target not found" });
    const target = result[0];

    try {
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
      throw new Error("Kashier error");
    } catch (error) {
      res.status(500).json({ msg: "Payment initiation failed" });
    }
  });
};

const KashierWebhook = (req, res) => {
  // 1. Immediate acknowledgement to Kashier
  res.status(200).send("OK");

  const { data, event } = req.body;
  if (event !== "pay") return;

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
    return;
  }

  // --- Process Successful Payment ---
  if (data.status === "SUCCESS") {
    const orderId = data.merchantOrderId; // This is either a request_id or an invoice_id
    const notifier = req.app.get("notifier");

    // Check if this ID belongs to an Invoice first
    connection.query("SELECT * FROM Invoices WHERE invoice_id = ?", [orderId], (invErr, invRows) => {
      if (invErr) return console.error("❌ Invoice Lookup Error:", invErr);

      if (invRows.length > 0) {
        // --- SCENARIO A: MONTHLY RENT PAYMENT ---
        const invoice = invRows[0];
        if (invoice.status === 'PAID') return; // Idempotency check

        const updateInvSql = `
          UPDATE Invoices 
          SET status = 'PAID', paid_at = CURRENT_TIMESTAMP, kashier_order_id = ? 
          WHERE invoice_id = ?
        `;

        connection.query(updateInvSql, [data.transactionId, orderId], (updErr) => {
          if (updErr) return console.error("❌ Failed to update Invoice:", updErr);
          
          notifier.send({
            receiver: invoice.renter_id,
            type: "MONTHLY_RENT_PAID",
            title: "Rent Paid Successfully ✅",
            body: `Your monthly rent payment of ${invoice.amount} EGP was received.`,
            metadata: { invoice_id: orderId, transaction_id: data.transactionId }
          });
          console.log(`✅ Monthly Invoice ${orderId} marked as PAID.`);
        });

      } else {
        // --- SCENARIO B: INITIAL RENT REQUEST (LEASE GRADUATION) ---
        connection.beginTransaction(transErr => {
          if (transErr) return console.error("❌ Transaction Error:", transErr);

          const getDetailsSql = `
            SELECT rr.*, p.owner_id, p.property_name 
            FROM renting_request rr
            JOIN Property p ON rr.property_id = p.property_id
            WHERE rr.request_id = ? FOR UPDATE
          `;

          connection.query(getDetailsSql, [orderId], (err, rows) => {
            if (err || rows.length === 0) {
              return connection.rollback(() => console.error("❌ Request not found:", orderId));
            }

            const requestDetails = rows[0];

            // Idempotency check
            if (requestDetails.request_state === 'PAID') return connection.rollback(() => {});

            const commission = requestDetails.total_price * 0.02;
            const ownerEarnings = requestDetails.total_price - commission;

            // Sequence of operations
            const queries = [
              // 1. Update Request State
              (cb) => connection.query(
                `UPDATE renting_request SET request_state = 'PAID', payment_id = ? WHERE request_id = ?`, 
                [data.transactionId, orderId], cb
              ),
              // 2. Pay the Landlord
              (cb) => connection.query(
                `UPDATE Users SET balance = balance + ? WHERE user_id = ?`, 
                [ownerEarnings, requestDetails.owner_id], cb
              ),
              // 3. Create the Actual Lease (The "Graduation")
              (cb) => {
                const leaseId = crypto.randomUUID();
                let nextBillingDate = null;
                if (requestDetails.renting_type === "MONTH") {
                  const nextBilling = new Date(requestDetails.check_in_date);
                  nextBilling.setMonth(nextBilling.getMonth() + 1);
                  nextBillingDate = nextBilling.toISOString().slice(0, 10);
                }
                connection.query(`
                  INSERT INTO Lease (lease_id, request_id, renter_id, owner_id, property_id, renting_type, status, check_in_date, check_out_date, next_billing_date)
                  VALUES (?, ?, ?, ?, ?, ?, 'UPCOMING', ?, ?, ?)`, 
                  [leaseId, orderId, requestDetails.renter_id, requestDetails.owner_id, requestDetails.property_id, requestDetails.renting_type, requestDetails.check_in_date, requestDetails.check_out_date, nextBillingDate], cb
                );
              },
              // 4. Log the Payment Intent
              (cb) => connection.query(`
                INSERT INTO PaymentIntents (payment_id, user_id, property_id, payment_type, value, payment_method, status)
                VALUES (?, ?, ?, 'rent', ?, ?, 'succeeded')`,
                [data.transactionId, requestDetails.renter_id, requestDetails.property_id, requestDetails.total_price, data.paymentMethod || "card"], cb
              )
            ];

            // Sequence Runner
            const runQuery = (index) => {
              if (index >= queries.length) {
                return connection.commit(commitErr => {
                  if (commitErr) return connection.rollback(() => {});
                  
                  // Notifications
                  notifier.send({
                    receiver: requestDetails.renter_id, 
                    type: "PAYMENT_SUCCESS", 
                    title: "Lease Confirmed! 🎉",
                    body: `Your booking for "${requestDetails.property_name}" is now confirmed.`,
                    metadata: { request_id: orderId }
                  });

                  notifier.send({
                    receiver: requestDetails.owner_id, 
                    type: "RENT_PAID", 
                    title: "New Booking! 💰",
                    body: `A renter has paid for "${requestDetails.property_name}".`,
                    metadata: { request_id: orderId }
                  });
                });
              }

              queries[index]((queryErr) => {
                if (queryErr) return connection.rollback(() => console.error("❌ Step Fail:", index, queryErr));
                runQuery(index + 1);
              });
            };

            runQuery(0);
          });
        });
      }
    });
  }
};

const refundPayment = async (req, res) => {
  const { request_id, reason } = req.body;

  if (!request_id) {
    return res.status(400).json({ msg: "Request ID is required" });
  }

  const getRequestSql = "SELECT * FROM renting_request WHERE request_id = ?";
  connection.query(getRequestSql, [request_id], async (err, results) => {
    if (err) return res.status(500).json({ msg: "Database error" });
    if (results.length === 0)
      return res.status(404).json({ msg: "Renting request not found" });

    const rentRequest = results[0];

    if (rentRequest.request_state !== "PAID") {
      return res
        .status(400)
        .json({ msg: "Refunds are only possible for paid requests." });
    }

    if (!rentRequest.payment_id) {
      return res
        .status(400)
        .json({ msg: "Payment ID is missing, cannot process refund." });
    }

    const kashier = new KashierPaymentService(
      process.env.PAYMENT_SEC_KEY,
      process.env.PAYMENT_API_KEY,
    );

    try {
      const refundResponse = await kashier.sendRefundRequest(
        rentRequest.total_price,
        rentRequest.payment_id,
        reason || "Owner requested refund",
      );

      if (refundResponse && refundResponse.status === "SUCCESS") {
        const updateRequestSql =
          "UPDATE renting_request SET request_state = 'REFUNDED' WHERE request_id = ?";
        connection.query(updateRequestSql, [request_id]);

        const paymentIntentId = crypto.randomUUID();
        const insertPaymentIntentSql = `
          INSERT INTO PaymentIntents (payment_id, user_id, property_id, payment_type, value, payment_method, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        connection.query(insertPaymentIntentSql, [
          paymentIntentId,
          rentRequest.renter_id,
          rentRequest.property_id,
          "refund",
          rentRequest.total_price,
          "card", // Assuming card, might need to be stored in rent_request
          "succeeded",
        ]);

        const notifier = req.app.get("notifier");
        notifier.send({
          receiver: rentRequest.renter_id,
          type: "PAYMENT_REFUNDED",
          title: "Refund Processed 🔄",
          body: `A refund of ${rentRequest.total_price} EGP has been issued for your request.`,
          metadata: { request_id: request_id, amount: rentRequest.total_price },
        });

        return res.status(200).json({ msg: "Refund processed successfully." });
      } else {
        return res.status(500).json({
          msg: "Refund failed at payment gateway.",
          details: refundResponse.message,
        });
      }
    } catch (error) {
      console.error("Refund Error: ", error);
      return res.status(500).json({
        msg: "An unexpected error occurred during the refund process.",
      });
    }
  });
};

const requestWithdrawal = async (req, res) => {
  const { amount, method, receiverData } = req.body;
  const userId = req.user.id;

  if (!amount || !method || !receiverData) {
    return res
      .status(400)
      .json({ msg: "Amount, method, and receiver data are required." });
  }

  connection.query(
    "SELECT balance FROM Users WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err)
        return res
          .status(500)
          .json({ msg: "Database error checking balance." });
      if (results.length === 0)
        return res.status(404).json({ msg: "User not found." });

      const balance = results[0].balance;
      if (balance < amount) {
        return res.status(400).json({ msg: "Insufficient balance." });
      }

      const paymentIntentId = crypto.randomUUID();
      const intentSql = `
            INSERT INTO PaymentIntents (payment_id, user_id, payment_type, value, payment_method, status)
            VALUES (?, ?, 'withdraw', ?, ?, 'pending')
        `;
      connection.query(
        intentSql,
        [paymentIntentId, userId, amount, method],
        async (err, intentResult) => {
          if (err)
            return res
              .status(500)
              .json({ msg: "Database error creating payment intent." });

          const kashier = new KashierPaymentService(
            process.env.PAYMENT_SEC_KEY,
          );

          try {
            const withdrawalResponse = await kashier.sendMoney(
              amount,
              method,
              receiverData,
            );

            if (withdrawalResponse && withdrawalResponse.status === "SUCCESS") {
              const newBalance = balance - amount;
              connection.query(
                "UPDATE Users SET balance = ? WHERE user_id = ?",
                [newBalance, userId],
              );
              connection.query(
                "UPDATE PaymentIntents SET status = 'succeeded' WHERE payment_id = ?",
                [paymentIntentId],
              );

              const notifier = req.app.get("notifier");
              notifier.send({
                receiver: userId,
                type: "WITHDRAWAL_SUCCESS",
                title: "Withdrawal Complete 🏦",
                body: `Your withdrawal of ${amount} EGP via ${method} was successful.`,
                metadata: { amount, method },
              });
              return res.status(200).json({ msg: "Withdrawal successful." });
            } else {
              connection.query(
                "UPDATE PaymentIntents SET status = 'failed' WHERE payment_id = ?",
                [paymentIntentId],
              );
              return res.status(500).json({
                msg: "Withdrawal failed at payment gateway.",
                details: withdrawalResponse.message,
              });
            }
          } catch (error) {
            console.error("Withdrawal Error: ", error);
            connection.query(
              "UPDATE PaymentIntents SET status = 'failed' WHERE payment_id = ?",
              [paymentIntentId],
            );
            return res.status(500).json({
              msg: "An unexpected error occurred during the withdrawal process.",
            });
          }
        },
      );
    },
  );
};

module.exports = {
  GetPaymentLink,
  KashierWebhook,
  refundPayment,
  requestWithdrawal,
};
