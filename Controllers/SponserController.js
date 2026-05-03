const connection = require("../DB");
require("dotenv").config();
const crypto = require("crypto");
const _ = require("underscore");
const queryString = require("query-string");

const {
  KashierPaymentService,
} = require("../Utils/classes/KashierPaymentService");

const SendPromotionRequest = async (req, res) => {
  const { property_id, duration, redirect } = req.body;
  const userId = req.user.userId; // Get the logged-in user ID
 
  const sponsorPlan = [1, 3, 6];
  const sponsorPrices = { 1: 250, 3: 700, 6: 1000 };

  const kashier = new KashierPaymentService(
    process.env.PAYMENT_SEC_KEY,
    process.env.PAYMENT_API_KEY,
    process.env.PAYMENT_MERCHENT_ID,
    redirect,
    `http://${process.env.URL}/api/sponser/webhook`,
  );

  if (!sponsorPlan.includes(Number(duration))) {
    return res
      .status(400)
      .json({ msg: "Duration should be 1, 3, or 6 months" });
  }

  // 1. Verify ownership and get email in one go
  const verifySql = `
    SELECT u.email FROM Users u 
    JOIN Property p ON u.user_id = p.owner_id 
    WHERE p.property_id = ? AND p.owner_id = ?`;

  connection.query(verifySql, [property_id, userId], async (err, rows) => {
    if (err) return res.status(500).json({ msg: "Database error" });

    if (rows.length === 0) {
      return res
        .status(403)
        .json({ msg: "Unauthorized: You do not own this property" });
    }

    const userEmail = rows[0].email;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(startDate.getMonth() + Number(duration));
    const amountToPay = sponsorPrices[duration];

    // 2. Insert/Update the sponsorship record
    const sql = `
      INSERT INTO Sponsored_Listings 
      (property_id, start_date, end_date, amount_paid, is_active, is_paid) 
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
      start_date = VALUES(start_date), 
      end_date = VALUES(end_date), 
      amount_paid = VALUES(amount_paid), 
      is_paid = FALSE,
      is_active = FALSE
    `;

    connection.query(
      sql,
      [property_id, startDate, endDate, amountToPay, false, false],
      async (dbErr) => {
        if (dbErr)
          return res.status(500).json({ msg: "Failed to save request" });

        // 3. Generate Kashier Payment Link
        try {
          const customer = { email: userEmail, reference: String(userId) }; // Reference is the User

          const sessionPayload = kashier.createPaymentSession(
            parseFloat(amountToPay),
            customer,
            "EGP",
            "AQAR:SPONSER:" + property_id, // merchantOrderId is the Property
          );

          const kashierResponse =
            await kashier.sendPaymentRequest(sessionPayload);

          if (kashierResponse?.sessionUrl) {
            return res.status(200).json({ url: kashierResponse.sessionUrl });
          }

          throw new Error("Kashier error");
        } catch (error) {
          res.status(500).json({ msg: "Payment initiation failed" });
        }
      },
    );
  });
};

const SponsorshipWebhook = (req, res) => {
  // 1. Acknowledge Kashier immediately
  res.status(200).send("OK");

  const { data, event } = req.body;

  // We only care about successful payment events
  if (event !== "pay" || data.status !== "SUCCESS") return;

  // --- Signature Verification ---
  // Using the same security logic to ensure the request actually came from Kashier
  const signatureKeys = data.signatureKeys.sort();
  const objectSignaturePayload = _.pick(data, signatureKeys);
  const signaturePayload = queryString.stringify(objectSignaturePayload);

  const generatedSignature = crypto
    .createHmac("sha256", process.env.PAYMENT_API_KEY)
    .update(signaturePayload)
    .digest("hex");

  if (generatedSignature !== req.header("x-kashier-signature")) {
    console.error("❌ Invalid Sponsorship Webhook Signature!");
    return;
  }

  // --- Process Sponsorship ---
  const orderId = data.merchantOrderId; // Expected format: "AQAR:SPONSER:123"

  if (typeof orderId === "string" && orderId.startsWith("AQAR:SPONSER:")) {
    const propertyId = orderId.split(":")[2];
    const notifier = req.app.get("notifier");

    const updateSql = `
      UPDATE Sponsored_Listings 
      SET is_paid = TRUE, is_active = TRUE 
      WHERE property_id = ?
    `;

    connection.query(updateSql, [propertyId], (err, result) => {
      if (err) return console.error("❌ DB Error activating sponsorship:", err);

      if (result.affectedRows > 0) {
        console.log(`✨ Sponsorship activated for property ${propertyId}`);

        // Fetch owner info to send a success notification
        const ownerSql = `
          SELECT u.user_id, p.property_name 
          FROM Property p 
          JOIN Users u ON p.owner_id = u.user_id 
          WHERE p.property_id = ?`;

        connection.query(ownerSql, [propertyId], (ownErr, rows) => {
          if (!ownErr && rows.length > 0) {
            notifier.send({
              receiver: rows[0].user_id,
              type: "PROMOTION_ACTIVATED",
              title: "Your Property is Now Featured! ✨",
              body: `The promotion for "${rows[0].property_name}" is now live.`,
              metadata: {
                property_id: propertyId,
                transactionId: data.transactionId,
              },
            });
          }
        });
      }
    });
  }
};

module.exports = { SendPromotionRequest, SponsorshipWebhook };
