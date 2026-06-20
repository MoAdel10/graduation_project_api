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

      // Notify property owner
      const notifier = req.app.get("notifier");
      if (notifier) {
        connection.query(
          "SELECT owner_id FROM property WHERE property_id = ?",
          [propId],
          (ownerErr, ownerRows) => {
            if (!ownerErr && ownerRows.length > 0) {
              notifier.send({
                receiver: ownerRows[0].owner_id,
                sender: userId,
                type: "NEW_REVIEW",
                title: "New Review Received",
                body: `A ${ratingVal}-star review was left on your property.`,
                metadata: { property_id: propId, rating: ratingVal },
              });
            }
          },
        );
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

        // Check for duplicate review
        connection.query(
          "SELECT review_id FROM reviews WHERE user_id = ? AND property_id = ? AND rent_id = ?",
          [userId, finalPropertyId, targetRentId],
          (dupErr, dupRows) => {
            if (dupErr) {
              console.error("❌ Error checking duplicate review:", dupErr);
              return res.status(500).json({ msg: "Database error checking existing review" });
            }

            if (dupRows.length > 0) {
              return res.status(409).json({ msg: "You have already reviewed this stay." });
            }

            insertReview(finalPropertyId, targetRentId);
          }
        );
      }
    );
  } else {
    // Just property_id provided — verify the user has a completed lease for this property
    connection.query(
      "SELECT lease_id, status FROM lease WHERE property_id = ? AND renter_id = ? AND status = 'COMPLETED'",
      [property_id, userId],
      (leaseErr, leaseRows) => {
        if (leaseErr) {
          console.error("❌ Error checking lease:", leaseErr);
          return res.status(500).json({ msg: "Database error checking lease" });
        }

        if (leaseRows.length === 0) {
          return res.status(403).json({ msg: "You can only review properties you have completed a stay at." });
        }

        const completedLeaseId = leaseRows[0].lease_id;

        // Check for duplicate review
        connection.query(
          "SELECT review_id FROM reviews WHERE user_id = ? AND property_id = ? AND rent_id = ?",
          [userId, property_id, completedLeaseId],
          (dupErr, dupRows) => {
            if (dupErr) {
              console.error("❌ Error checking duplicate review:", dupErr);
              return res.status(500).json({ msg: "Database error checking existing review" });
            }

            if (dupRows.length > 0) {
              return res.status(409).json({ msg: "You have already reviewed this property." });
            }

            insertReview(property_id, completedLeaseId);
          }
        );
      }
    );
  }
};

module.exports = {
  getReviews,
  addReview
};
