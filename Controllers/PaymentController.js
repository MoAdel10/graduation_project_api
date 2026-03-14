const connection = require("../DB");
require("dotenv").config();
const crypto = require("crypto");
const _ = require("underscore");
const queryString = require("query-string").default || require("query-string");
const {
  KashierPaymentService,
} = require("../Utils/classes/KashierPaymentService");

const GetPaymentLink = async (req, res) => {
  const { request_id, redirect } = req.body;

  const kashier = new KashierPaymentService(
    process.env.PAYMENT_SEC_KEY,
    process.env.PAYMENT_API_KEY,
    process.env.PAYMENT_MERCHENT_ID,
    redirect,
    `http://${process.env.URL}/payment/webhook`,
  );

  const sql = `
    SELECT rr.*, u.email, u.user_id 
    FROM renting_request rr
    JOIN Users u ON rr.renter_id = u.user_id 
    WHERE rr.request_id = ?
  `;

  connection.query(sql, [request_id], async (err, result) => {
    if (err) return res.status(500).json({ msg: "Database error" });
    if (result.length === 0)
      return res.status(404).json({ msg: "Request not found" });

    const rent_request = result[0];

    try {
      const customer = {
        email: rent_request.email,
        reference: String(rent_request.request_id),
      };

      const sessionPayload = kashier.createPaymentSession(
        parseFloat(rent_request.total_price),
        customer,
        "EGP",
        rent_request.request_id,
      );

      const kashierResponse = await kashier.sendPaymentRequest(sessionPayload);

      if (
        kashierResponse &&
        (kashierResponse.status === "CREATED" || kashierResponse.sessionUrl)
      ) {
        const updateSql =
          "UPDATE renting_request SET request_state = 'PAYMENT_PENDING' WHERE request_id = ?";

        connection.query(updateSql, [rent_request.request_id], (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error: ", updateErr);
            return res
              .status(500)
              .json({ msg: "Failed to update request state" });
          }

          return res.status(200).json({
            url: kashierResponse.sessionUrl,
          });
        });
      } else {
        throw new Error("Kashier session creation failed");
      }
    } catch (error) {
      console.error("❌ Payment Error: ", error);
      res.status(500).json({ msg: "Payment initiation failed" });
    }
  });
};




const KashierWebhook = (req, res) => {
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
    const requestId = data.merchantOrderId;

    connection.beginTransaction(transErr => {
      if (transErr) {
        console.error("❌ Transaction Start Error:", transErr);
        return;
      }

      const getDetailsSql = `
        SELECT 
          rr.renter_id, rr.property_id, rr.total_price, rr.renting_type, 
          rr.check_in_date, rr.check_out_date, rr.request_state,
          p.owner_id, p.property_name 
        FROM renting_request rr
        JOIN Property p ON rr.property_id = p.property_id
        WHERE rr.request_id = ? FOR UPDATE
      `;

      connection.query(getDetailsSql, [requestId], (err, rows) => {
        if (err || rows.length === 0) {
          console.error("❌ Webhook Lookup Error:", err || "Request not found");
          return connection.rollback(() => {});
        }

        const requestDetails = rows[0];

        // IDEMPOTENCY CHECK
        if (requestDetails.request_state === 'PAID') {
          console.log(`✅ Request ${requestId} already processed. Ignoring webhook.`);
          return connection.rollback(() => {}); // Use rollback to release lock
        }
        
        if (requestDetails.request_state !== 'ACCEPTED' && requestDetails.request_state !== 'PAYMENT_PENDING') {
           console.error(`❌ Request ${requestId} is not in an acceptable state for payment: ${requestDetails.request_state}`);
           return connection.rollback(()=>{});
        }


        const {
          renter_id, owner_id, property_id, property_name, total_price,
          renting_type, check_in_date, check_out_date
        } = requestDetails;

        const commission = total_price * 0.02;
        const ownerEarnings = total_price - commission;

        // Chain of queries within the transaction
        const queries = [
          (cb) => connection.query(`UPDATE renting_request SET request_state = 'PAID', payment_id = ? WHERE request_id = ?`, [data.transactionId, requestId], cb),
          (cb) => connection.query(`UPDATE Users SET balance = balance + ? WHERE user_id = ?`, [ownerEarnings, owner_id], cb),
          (cb) => {
            const leaseId = crypto.randomUUID();
            let nextBillingDate = null;
            if (renting_type === "MONTH") {
              const nextBilling = new Date(check_in_date);
              nextBilling.setMonth(nextBilling.getMonth() + 1);
              nextBillingDate = nextBilling.toISOString().slice(0, 10);
            }
            connection.query(`
              INSERT INTO Lease (lease_id, request_id, renter_id, owner_id, property_id, renting_type, status, check_in_date, check_out_date, next_billing_date)
              VALUES (?, ?, ?, ?, ?, ?, 'UPCOMING', ?, ?, ?)`, 
              [leaseId, requestId, renter_id, owner_id, property_id, renting_type, check_in_date, check_out_date, nextBillingDate], cb
            );
          },
          (cb) => connection.query(`
            INSERT INTO PaymentIntents (payment_id, user_id, property_id, payment_type, value, payment_method, status)
            VALUES (?, ?, ?, 'rent', ?, ?, 'succeeded')`,
            [data.transactionId, renter_id, property_id, total_price, data.paymentMethod || "card"], cb
          )
        ];

        // Execute queries in sequence
        const runQuery = (index) => {
          if (index >= queries.length) {
            // All queries succeeded, commit the transaction
            connection.commit(commitErr => {
              if (commitErr) {
                return connection.rollback(() => console.error("❌ Commit Error:", commitErr));
              }

              // Send notifications AFTER commit
              const notifier = req.app.get("notifier");
              notifier.send({
                receiver: renter_id, type: "PAYMENT_SUCCESS", title: "Rent Payment Confirmed! ✅",
                body: `Your payment for "${property_name}" rent was successful`,
                metadata: { request_id: requestId, transaction_id: data.transactionId },
              });
              notifier.send({
                receiver: owner_id, type: "RENT_PAID", title: "Rent Paid! 💰",
                body: `The renter has paid for "${property_name}". The funds are being processed.`,
                metadata: { request_id: requestId, amount: total_price },
              });
              console.log(`✅ Processed payment for Request ${requestId}`);
            });
            return;
          }

          queries[index]((queryErr, result) => {
            if (queryErr) {
              return connection.rollback(() => console.error(`❌ DB Error at step ${index}:`, queryErr));
            }
            runQuery(index + 1);
          });
        };
        
        runQuery(0);
      });
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
