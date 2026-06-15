const connection = require("../DB");

/**
 * GET /Reviews
 * Fetch reviews. If property_id query parameter is passed, only returns reviews for that property.
 * Returns review details along with the user's name.
 */
const getReviews = (req, res) => {
  const { property_id } = req.query;

  let sql = `
    SELECT 
      r.review_id,
      r.property_id,
      r.rent_id,
      r.rating,
      r.phrase,
      r.created_at,
      u.first_name,
      u.second_name,
      u.email
    FROM reviews r
    JOIN users u ON r.user_id = u.user_id
  `;
  const params = [];

  if (property_id) {
    sql += " WHERE r.property_id = ?";
    params.push(property_id);
  }

  sql += " ORDER BY r.created_at DESC";

  connection.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ Error fetching reviews:", err);
      return res.status(500).json({ msg: "Database error" });
    }
    res.status(200).json({ success: true, data: results });
  });
};

/**
 * POST /review
 * Add a review. Connected to user_id (from token), and rent_id/lease_id or property_id.
 * Validates rating is a float 1-5.
 */
const addReview = (req, res) => {
  const { rating, phrase, rent_id, property_id, lease_id } = req.body;
  const userId = req.user.userId;

  const targetRentId = rent_id || lease_id || null;

  const ratingVal = parseFloat(rating);
  if (isNaN(ratingVal) || ratingVal < 1 || ratingVal > 5) {
    return res.status(400).json({ msg: "Rating must be a float between 1 and 5" });
  }

  if (!property_id && !targetRentId) {
    return res.status(400).json({ msg: "property_id or rent_id is required" });
  }

  let finalPropertyId = property_id;

  const insertReview = (propId, leaseId) => {
    const insertSql = `
      INSERT INTO reviews (user_id, property_id, rent_id, rating, phrase)
      VALUES (?, ?, ?, ?, ?)
    `;
    connection.query(insertSql, [userId, propId, leaseId, ratingVal, phrase || ""], (err, result) => {
      if (err) {
        console.error("❌ Error inserting review:", err);
        return res.status(500).json({ msg: "Database error inserting review" });
      }

      // Automatically recalculate and update Property rating
      const updateRateSql = `
        UPDATE property 
        SET rate = (SELECT AVG(rating) FROM reviews WHERE property_id = ?) 
        WHERE property_id = ?
      `;
      connection.query(updateRateSql, [propId, propId], (rateErr) => {
        if (rateErr) {
          console.error("❌ Error updating property rate:", rateErr);
        }
        res.status(201).json({
          success: true,
          msg: "Review added successfully",
          review_id: result.insertId || null
        });
      });
    });
  };

  if (targetRentId) {
    // Verify that the lease exists, belongs to this renter, and get the property_id
    connection.query(
      "SELECT property_id, status FROM lease WHERE lease_id = ? AND renter_id = ?",
      [targetRentId, userId],
      (leaseErr, leaseRows) => {
        if (leaseErr) {
          console.error("❌ Error checking lease:", leaseErr);
          return res.status(500).json({ msg: "Database error checking lease" });
        }

        if (leaseRows.length === 0) {
          return res.status(404).json({ msg: "No rent/lease found for this user with the given rent_id." });
        }

        const lease = leaseRows[0];
        finalPropertyId = lease.property_id;

        insertReview(finalPropertyId, targetRentId);
      }
    );
  } else {
    // Just property_id provided, verify property exists
    connection.query(
      "SELECT property_id FROM property WHERE property_id = ?",
      [property_id],
      (propErr, propRows) => {
        if (propErr) {
          console.error("❌ Error checking property:", propErr);
          return res.status(500).json({ msg: "Database error checking property" });
        }

        if (propRows.length === 0) {
          return res.status(404).json({ msg: "Property not found." });
        }

        insertReview(finalPropertyId, null);
      }
    );
  }
};

module.exports = {
  getReviews,
  addReview
};
