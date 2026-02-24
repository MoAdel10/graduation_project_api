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
        reference: rent_request.request_id,
      };

      const sessionPayload = kashier.createPaymentSession(
        parseFloat(rent_request.total_price),
        customer,
        (currency = "EGP"),
        (order_id = rent_request.request_id),
      );

      const kashierResponse = await kashier.sendPaymentRequest(sessionPayload);

      // 3. Return the redirect URL to your frontend
      if (kashierResponse.status == "CREATED" || kashierResponse.response) {
        connection.query(
          "UPDATE renting_request set request_state = 'PAYMENT_PENDING' whree request_id = ?",
          rent_request.request_id,
          (err, result) => {
            return res.status(200).json({
              url: kashierResponse.sessionUrl,
            });
          },
        );
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
  // 1. Immediately acknowledge with 200 OK (Kashier's requirement)
  res.status(200).send("OK");

  const { data, event } = req.body;
  if (event !== "pay") return; // We only care about successful payments

  // 2. Verify Signature
  const signatureKeys = data.signatureKeys.sort();
  const objectSignaturePayload = _.pick(data, signatureKeys);

  // Values must be URL encoded during stringify
  const signaturePayload = queryString.stringify(objectSignaturePayload);

  const generatedSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_API_KEY)
    .update(signaturePayload)
    .digest("hex");

  const kashierHeaderSignature = req.header("x-kashier-signature");

  if (generatedSignature !== kashierHeaderSignature) {
    console.error("❌ Invalid Webhook Signature!");
    return;
  }

  // 3. Update Database if Payment is Successful
  if (data.status === "SUCCESS") {
    const requestId = data.merchantOrderId; // This is the ID we passed in 'reference' earlier

    const updateSql = `
            UPDATE renting_request 
            SET request_state = 'PAID', payment_id = ? 
            WHERE request_id = ?
        `;

    connection.query(
      updateSql,
      [data.transactionId, requestId],
      (err, result) => {
        if (err) console.error("❌ DB Update Error:", err);
        else console.log(`✅ Request ${requestId} marked as PAID.`);
      },
    );

    // Optional: Insert into your PaymentIntents table
    // INSERT INTO PaymentIntents (user_id, property_id, payment_type, value...)
  }
};

module.exports = { GetPaymentLink, KashierWebhook };
