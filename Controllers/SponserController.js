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
  const userId = req.user.userId;

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

  // 1. Verify ownership and check for existing "Stacked" promotions
  // We look for the latest end_date among PAID promotions for this property
  const checkSql = `
    SELECT u.email, 
    (SELECT MAX(end_date) FROM Sponsored_Listings WHERE property_id = ? AND is_paid = TRUE AND end_date > NOW()) as latest_expiry
    FROM Users u 
    JOIN Property p ON u.user_id = p.owner_id 
    WHERE p.property_id = ? AND p.owner_id = ?`;

  connection.query(
    checkSql,
    [property_id, property_id, userId],
    async (err, rows) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      if (rows.length === 0)
        return res.status(403).json({ msg: "Unauthorized" });

      const userEmail = rows[0].email;
      const latestExpiry = rows[0].latest_expiry;

      // Determine the Start Date:
      // If an active promotion exists, start after it. Otherwise, start NOW.
      let startDate = latestExpiry ? new Date(latestExpiry) : new Date();

      let endDate = new Date(startDate);
      endDate.setMonth(startDate.getMonth() + Number(duration));

      const amountToPay = sponsorPrices[duration];

      // 2. Insert a NEW record (Each attempt gets a unique ID)
      const insertSql = `
      INSERT INTO Sponsored_Listings 
      (property_id, start_date, end_date, amount_paid, is_active, is_paid) 
      VALUES (?, ?, ?, ?, FALSE, FALSE)
    `;

      connection.query(
        insertSql,
        [property_id, startDate, endDate, amountToPay],
        async (dbErr, result) => {
          if (dbErr)
            return res.status(500).json({ msg: "Failed to save request" });

          const promotionId = result.insertId; // Unique ID for this specific transaction

          try {
            const customer = { email: userEmail, reference: String(userId) };
            const dateStr = new Date().toISOString().split("T")[0];

            // We include promotionId in the orderId so the Webhook knows EXACTLY which row to update
            const merchantOrderId = `AQAR:SPONSER:${property_id}:${promotionId}:${dateStr}`;

            const sessionPayload = kashier.createPaymentSession(
              parseFloat(amountToPay),
              customer,
              "EGP",
              merchantOrderId,
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
    },
  );
};

const SponsorshipWebhook = (req, res) => {
  // 1. Acknowledge Kashier immediately to prevent retries
  res.status(200).send("OK");

  const { data, event } = req.body;

  // We only care about successful payment events
  if (event !== "pay" || data.status !== "SUCCESS") return;

  // --- Signature Verification ---
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
  const orderId = data.merchantOrderId;
  // Expected format: "AQAR:SPONSER:propId:promotionId:date"

  if (typeof orderId === "string" && orderId.startsWith("AQAR:SPONSER:")) {
    const parts = orderId.split(":");
    const propertyId = parts[2];
    const promotionId = parts[3]; // The unique ID for this specific row

    const notifier = req.app.get("notifier");

    // We update the specific promotion record
    // Logic: is_active only becomes TRUE if start_date is now or in the past
    const updateSql = `
      UPDATE Sponsored_Listings 
      SET is_paid = TRUE, 
          is_active = CASE 
            WHEN start_date <= NOW() THEN TRUE 
            ELSE FALSE 
          END,
          payment_ref = ?
      WHERE promotion_id = ?
    `;

    connection.query(updateSql, [orderId, promotionId], (err, result) => {
      if (err) return console.error("❌ DB Error activating sponsorship:", err);

      if (result.affectedRows > 0) {
        console.log(
          `✨ Sponsorship record ${promotionId} activated for property ${propertyId}`,
        );

        // Fetch owner info for the success notification
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
              title: "Promotion Confirmed! ✨",
              body: `Success! The promotion for "${rows[0].property_name}" is confirmed.`,
              metadata: {
                property_id: propertyId,
                promotion_id: promotionId,
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
