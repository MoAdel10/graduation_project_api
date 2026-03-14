const connection = require("../DB");
const crypto = require("crypto");

const getRentRequests = (req, res) => {
  const { userId } = req.user;

  const sql = `
    SELECT 
      rr.*, 
      p.property_name, 
      p.owner_id,
      CASE 
        WHEN rr.renter_id = ? THEN 'SENT'
        WHEN p.owner_id = ? THEN 'RECEIVED'
      END AS perspective
    FROM renting_request rr
    JOIN Property p ON rr.property_id = p.property_id
    WHERE rr.renter_id = ? OR p.owner_id = ?
    ORDER BY rr.created_at DESC
  `;

  connection.query(sql, [userId, userId, userId, userId], (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ msg: "Database error" });
    }

    const sent = results.filter((r) => r.perspective === "SENT");
    const received = results.filter((r) => r.perspective === "RECEIVED");

    res.status(200).json({
      success: true,
      data: {
        sent,
        received,
      },
    });
  });
};

// Helper: validate YYYY-MM-DD dates + basic ordering
function validateDateRange(checkIn, checkOut) {
  if (!checkIn || !checkOut)
    return { ok: false, msg: "check_in_date and check_out_date are required" };

  // Very basic format check (usually 'YYYY-MM-DD')
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(checkIn) || !dateRegex.test(checkOut)) {
    return { ok: false, msg: "Invalid date format. Use YYYY-MM-DD" };
  }

  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);

  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) {
    return { ok: false, msg: "Invalid date values" };
  }

  if (outDate <= inDate) {
    return { ok: false, msg: "check_out_date must be after check_in_date" };
  }

  return { ok: true };
}

// Helper: overlap rule
// overlap if newIn < existingOut AND newOut > existingIn
function hasOverlap(propertyId, checkIn, checkOut, excludeRequestId, cb) {
  const sql = `
    SELECT 1
    FROM renting_request
    WHERE property_id = ?
      AND request_id <> ?
      AND request_state IN ('ACCEPTED', 'PAID')
      AND ? < check_out_date
      AND ? > check_in_date
    LIMIT 1
  `;
  connection.query(
    sql,
    [propertyId, excludeRequestId, checkIn, checkOut],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, rows.length > 0);
    },
  );
}

function hasDuplicateRequest(renterId, propertyId, checkIn, checkOut, cb) {
  const sql = `
    SELECT 1
    FROM renting_request
    WHERE renter_id = ?
      AND property_id = ?
      AND request_state IN ('PENDING', 'ACCEPTED', 'PAID')
      AND ? < check_out_date
      AND ? > check_in_date
    LIMIT 1
  `;
  connection.query(
    sql,
    [renterId, propertyId, checkIn, checkOut],
    (err, rows) => {
      if (err) return cb(err);
      cb(null, rows.length > 0);
    },
  );
}

/**
 * POST /rent-requests
 * Who: Renter
 */
const createRentRequest = (req, res) => {
  const renterId = req.user.userId;
  const { property_id, check_in_date, check_out_date, renting_type } = req.body;

  // 0) Basic validation
  if (!property_id || !check_in_date || !check_out_date || !renting_type) {
    return res.status(400).json({
      msg: "property_id, check_in_date, check_out_date, and renting_type are required",
    });
  }

  if (!["DAY", "MONTH"].includes(renting_type)) {
    return res
      .status(400)
      .json({ msg: "Invalid renting_type. Use 'DAY' or 'MONTH'" });
  }

  const dateCheck = validateDateRange(check_in_date, check_out_date);
  if (!dateCheck.ok) {
    return res.status(400).json({ msg: dateCheck.msg });
  }

  // 1) Property lookup
  const propSql = `
    SELECT property_id, owner_id, price_per_day, price_value, pricing_unit, is_available, is_verified, property_name
    FROM Property
    WHERE property_id = ?
    LIMIT 1
  `;
  connection.query(propSql, [property_id], (err, props) => {
    if (err) {
      console.error("❌ DB error (property lookup):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (props.length === 0) {
      return res.status(404).json({ msg: "Property not found" });
    }

    const property = props[0];

    if (property.owner_id === renterId) {
      return res.status(400).json({ msg: "You can't rent your own property" });
    }
    if (property.is_available === 0) {
      return res.status(409).json({ msg: "Property is not available for renting right now" });
    }
    if (property.is_verified == false) {
      return res.status(400).json({ msg: "Property is not verified" });
    }

    // Start Transaction
    connection.beginTransaction(transErr => {
      if (transErr) {
        return res.status(500).json({ msg: "Database error starting transaction." });
      }

      // 2) Property availability check (inside transaction)
      hasOverlap(
        property.property_id,
        check_in_date,
        check_out_date,
        null, // No request ID to exclude yet
        (err, overlap) => {
          if (err) {
            return connection.rollback(() => res.status(500).json({ msg: "Database error during overlap check." }));
          }
          if (overlap) {
            return connection.rollback(() => res.status(409).json({ msg: "Property already reserved for these dates" }));
          }

          // 3) Idempotency check (inside transaction)
          hasDuplicateRequest(
            renterId,
            property.property_id,
            check_in_date,
            check_out_date,
            (err, exists) => {
              if (err) {
                return connection.rollback(() => res.status(500).json({ msg: "Database error during duplicate check." }));
              }
              if (exists) {
                return connection.rollback(() => res.status(409).json({ msg: "You already have an active rent request for this property and date range" }));
              }

              // 4) Calculate price
              let totalPrice;
              if (renting_type === "DAY") {
                if (!["DAY", "MONTH", "YEAR"].includes(property.pricing_unit)) {
                     return res.status(400).json({ msg: "This property is not available for daily rent." });
                }
                const days = Math.round((new Date(check_out_date) - new Date(check_in_date)) / (1000 * 60 * 60 * 24));
                if(days <= 0) return res.status(400).json({ msg: "Invalid date range" });
                
                const pricePerDay = Number(property.price_per_day);
                if (!pricePerDay || pricePerDay <= 0) return res.status(400).json({ msg: "Property price_per_day is invalid" });
                
                totalPrice = Number((pricePerDay * days).toFixed(2));
                insertRentRequest(totalPrice);
              } else { // MONTH
                  if (property.pricing_unit !== "MONTH") {
                    return res.status(400).json({ msg: "This property is not available for monthly rent." });
                  }
                  totalPrice = Number(property.price_value);
                  insertRentRequest(totalPrice);
              }

              function insertRentRequest(totalPrice) {
                const requestId = crypto.randomUUID();
                const insertSql = `
                  INSERT INTO renting_request
                    (request_id, property_id, renter_id, renting_type, request_state, total_price, check_in_date, check_out_date)
                  VALUES
                    (?, ?, ?, ?, 'PENDING', ?, ?, ?)
                `;

                connection.query(insertSql, [requestId, property.property_id, renterId, renting_type, totalPrice, check_in_date, check_out_date], (err) => {
                  if (err) {
                    return connection.rollback(() => res.status(500).json({ msg: "Database error creating request." }));
                  }

                  // If all goes well, commit the transaction
                  connection.commit(commitErr => {
                    if (commitErr) {
                      return connection.rollback(() => res.status(500).json({ msg: "Database error committing transaction." }));
                    }

                    // Send notification AFTER successful commit
                    const notifier = req.app.get("notifier");
                    notifier.send({
                      sender: renterId,
                      receiver: property.owner_id,
                      type: "RENT_REQUEST",
                      title: "New Rent Request!",
                      body: `A user wants to rent "${property.property_name}" from ${check_in_date} to ${check_out_date}.`,
                      metadata: {
                        request_id: requestId,
                        property_id: property.property_id,
                        type: "rent_request",
                      },
                    });

                    return res.status(201).json({
                      msg: "Rent request created",
                      request_id: requestId,
                      request_state: "PENDING",
                      total_price: totalPrice,
                    });
                  });
                });
              }
            }
          );
        }
      );
    });
  });
};

const getRentRequestById = (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ msg: "id is required or not valid" });
  }

  connection.query(
    "SELECT * FROM renting_request WHERE request_id = ?",
    [id],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching rent request by ID:", err);
        return res.status(500).json({ msg: "Database error" });
      }
      if (results.length === 0) {
        return res.status(404).json({ msg: "Request not found" });
      }
      const rent_request = results[0];
      res.status(200).json(rent_request);
    },
  );
};

/**
 * POST /rent-requests/:id/accept
 * Who: Landlord
 */
const acceptRentRequest = (req, res) => {
  const landlordId = req.user.userId;
  const requestId = req.params.id;

  // Get request + property owner + dates
  const sql = `
    SELECT rr.request_id, rr.property_id, rr.renter_id, rr.request_state,
           rr.check_in_date, rr.check_out_date,
           p.owner_id
    FROM renting_request rr
    INNER JOIN Property p ON rr.property_id = p.property_id
    WHERE rr.request_id = ?
    LIMIT 1
  `;
  connection.query(sql, [requestId], (err, rows) => {
    if (err) {
      console.error("❌ DB error (accept lookup):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (rows.length === 0)
      return res.status(404).json({ msg: "Rent request not found" });

    const rr = rows[0];

    // ownership
    if (rr.owner_id !== landlordId) {
      return res.status(403).json({ msg: "Unauthorized" });
    }

    // must be pending
    if (rr.request_state !== "PENDING") {
      return res.status(409).json({
        msg: `Request can't be accepted from state ${rr.request_state}`,
      });
    }

    // (recommended) re-check overlap before accept to avoid double-booking
    hasOverlap(
      rr.property_id,
      rr.check_in_date,
      rr.check_out_date,
      rr.request_id,
      (err, overlap) => {
        if (err) {
          console.error("❌ DB error (accept overlap):", err);
          return res.status(500).json({ msg: "Database error" });
        }
        if (overlap) {
          return res
            .status(409)
            .json({ msg: "Property already reserved for these dates" });
        }

        // Atomic update: only if still pending
        const updateSql = `
        UPDATE renting_request
        SET request_state = 'ACCEPTED'
        WHERE request_id = ? AND request_state = 'PENDING'
      `;
        connection.query(updateSql, [requestId], (err, result) => {
          if (err) {
            console.error("❌ DB error (accept update):", err);
            return res.status(500).json({ msg: "Database error" });
          }

          if (result.affectedRows === 0) {
            return res.status(409).json({
              msg: "Request was already updated (not PENDING anymore)",
            });
          }

          const notifier = req.app.get("notifier");
          notifier.send({
            sender: landlordId,
            receiver: rr.renter_id,
            type: "RENT_REQUEST_ACCEPTED",
            title: "Request Accepted! 🎉",
            body: `Your rent request for the property has been accepted. You can now proceed to payment.`,
            metadata: {
              request_id: requestId,
              property_id: rr.property_id,
              status: "ACCEPTED",
            },
          });

          return res
            .status(200)
            .json({ msg: "Rent request accepted", request_state: "ACCEPTED" });
        });
      },
    );
  });
};

/**
 * POST /rent-requests/:id/reject
 * Who: Landlord
 */

const rejectRentRequest = (req, res) => {
  const landlordId = req.user.userId;
  const requestId = req.params.id;

  
  const findSql = `
    SELECT rr.renter_id, rr.property_id, p.property_name 
    FROM renting_request rr
    JOIN Property p ON rr.property_id = p.property_id
    WHERE rr.request_id = ? AND p.owner_id = ? AND rr.request_state = 'PENDING'
  `;

  connection.query(findSql, [requestId, landlordId], (err, rows) => {
    if (err) {
      console.error("❌ DB error (reject lookup):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (rows.length === 0) {
      return res.status(404).json({ 
        msg: "Request not found, not pending, or not owned by you" 
      });
    }

    const { renter_id, property_id, property_name } = rows[0];

    // 2. Perform the Update
    const updateSql = `
      UPDATE renting_request 
      SET request_state = 'REJECTED' 
      WHERE request_id = ? AND request_state = 'PENDING'
    `;

    connection.query(updateSql, [requestId], (err, result) => {
      if (err) {
        console.error("❌ DB error (reject update):", err);
        return res.status(500).json({ msg: "Database error" });
      }

      // 3. Send Notification
      const notifier = req.app.get("notifier");
      notifier.send({
        sender: landlordId,
        receiver: renter_id, 
        type: 'RENT_REQUEST_REJECTED',
        title: 'Request Declined',
        body: `Your rent request for "${property_name}" was declined by the owner.`,
        metadata: { 
          request_id: requestId, 
          property_id: property_id,
          status: 'REJECTED' 
        }
      });

      return res.status(200).json({ 
        msg: "Rent request rejected", 
        request_state: "REJECTED" 
      });
    });
  });
};

/**
 * POST /rent-requests/:id/cancel
 * Who: Renter
 */
const cancelRentRequest = (req, res) => {
  const renterId = req.user.userId;
  const requestId = req.params.id;

  // 1. Find the request first to get details for notification
  const findSql = `
    SELECT p.owner_id, p.property_name
    FROM renting_request rr
    JOIN Property p ON rr.property_id = p.property_id
    WHERE rr.request_id = ? 
      AND rr.renter_id = ? 
      AND rr.request_state IN ('PENDING', 'ACCEPTED')
  `;

  connection.query(findSql, [requestId, renterId], (err, rows) => {
    if (err) {
      console.error("❌ DB error (cancel lookup):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (rows.length === 0) {
      return res.status(404).json({
        msg: "Request not found, not yours, or cannot be cancelled now.",
      });
    }

    const { owner_id, property_name } = rows[0];

    // 2. Perform the update
    const updateSql = `
      UPDATE renting_request
      SET request_state = 'CANCELLED'
      WHERE request_id = ?
    `;

    connection.query(updateSql, [requestId], (err, result) => {
      if (err || result.affectedRows === 0) {
        console.error("❌ DB error (cancel update):", err);
        return res.status(500).json({ msg: "Failed to cancel request" });
      }

      // 3. Send notification
      const notifier = req.app.get("notifier");
      notifier.send({
        sender: renterId,
        receiver: owner_id,
        type: "RENT_REQUEST_CANCELLED",
        title: "Request Cancelled",
        body: `The renter has cancelled their request for "${property_name}".`,
        metadata: { request_id: requestId },
      });

      return res
        .status(200)
        .json({ msg: "Rent request cancelled", request_state: "CANCELLED" });
    });
  });
};

module.exports = {
  createRentRequest,
  acceptRentRequest,
  rejectRentRequest,
  cancelRentRequest,
  getRentRequests,
  getRentRequestById,
};
