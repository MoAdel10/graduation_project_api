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
    if (result.length === 0) return res.status(404).json({ msg: "Request not found" });

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
        rent_request.request_id
      );

      const kashierResponse = await kashier.sendPaymentRequest(sessionPayload);

      
      if (kashierResponse && (kashierResponse.status === "CREATED" || kashierResponse.sessionUrl)) {
        
    
        const updateSql = "UPDATE renting_request SET request_state = 'PAYMENT_PENDING' WHERE request_id = ?";
        
        connection.query(updateSql, [rent_request.request_id], (updateErr) => {
          if (updateErr) {
            console.error("❌ Update Error: ", updateErr);
            return res.status(500).json({ msg: "Failed to update request state" });
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

 
  const signatureKeys = data.signatureKeys.sort();
  const objectSignaturePayload = _.pick(data, signatureKeys);

  
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

  
  if (data.status === "SUCCESS") {
    const requestId = data.merchantOrderId; // ID  passed in reference earlier

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
  }
};

module.exports = { GetPaymentLink, KashierWebhook };
