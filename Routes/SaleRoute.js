const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const saleController = require('../Controllers/SaleController');
const verifyToken = require('../Middleware/verifyToken');
const pool = require('../DB').promise();

const PLAN_PRICES = { 1: 120, 3: 360, 6: 600 };
const VALID_MONTHS = [1, 3, 6];

router.post('/property/:property_id/sold', verifyToken, saleController.markPropertyAsSold);

router.get('/subscription/:propertyId', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT subscription_id, property_id, owner_id, plan_months, amount, status
       FROM listingsubscriptions
       WHERE property_id = ? AND owner_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.propertyId, req.user.userId],
    );
    if (rows.length === 0) return res.status(404).json({ msg: "No subscription found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error fetching subscription:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

router.post('/subscription/:propertyId', verifyToken, async (req, res) => {
  const { planMonths } = req.body;
  const propertyId = Number(req.params.propertyId);

  if (!VALID_MONTHS.includes(planMonths)) {
    return res.status(400).json({ msg: "Invalid plan. Must be 1, 3, or 6 months." });
  }

  try {
    const [props] = await pool.query(
      "SELECT property_id, owner_id, property_type FROM property WHERE property_id = ? AND owner_id = ?",
      [propertyId, req.user.userId],
    );
    if (props.length === 0) return res.status(404).json({ msg: "Property not found" });

    if (props[0].property_type !== "for_sale") {
      return res.status(400).json({ msg: "Property is not a for-sale listing." });
    }

    const [existing] = await pool.query(
      "SELECT subscription_id FROM listingsubscriptions WHERE property_id = ? AND status IN ('UNPAID', 'PAID') LIMIT 1",
      [propertyId],
    );
    if (existing.length > 0) {
      return res.status(409).json({ msg: "A subscription already exists for this property." });
    }

    const subscriptionId = crypto.randomUUID();
    const amount = PLAN_PRICES[planMonths];

    await pool.query(
      `INSERT INTO listingsubscriptions (subscription_id, property_id, owner_id, plan_months, amount)
       VALUES (?, ?, ?, ?, ?)`,
      [subscriptionId, propertyId, req.user.userId, planMonths, amount],
    );

    res.status(201).json({
      subscription_id: subscriptionId,
      property_id: propertyId,
      plan_months: planMonths,
      amount,
      status: "UNPAID",
    });
  } catch (err) {
    console.error("❌ Error creating subscription:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

module.exports = router;
