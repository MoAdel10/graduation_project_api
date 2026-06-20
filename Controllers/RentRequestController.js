const pool = require("../DB");
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
    JOIN property p ON rr.property_id = p.property_id
    WHERE rr.renter_id = ? OR p.owner_id = ?
    ORDER BY rr.created_at DESC
  `;

  pool.query(sql, [userId, userId, userId, userId], (err, results) => {
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

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(checkIn) || !dateRegex.test(checkOut)) {
    return { ok: false, msg: "Invalid date format. Use YYYY-MM-DD" };
  }

  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);

  if (Number.isNaN(inDate.getTime()) || Number.isNaN(outDate.getTime())) {
    return { ok: false, msg: "Invalid date values" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (inDate.getTime() <= today.getTime()) {
    return { ok: false, msg: "check_in_date must be at least tomorrow" };
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
      AND (? IS NULL OR request_id <> ?)
      AND request_state IN ('PENDING', 'ACCEPTED', 'PAID')
      AND ? <= check_out_date
      AND ? > check_in_date
    LIMIT 1
  `;
  pool.query(
    sql,
    [propertyId, excludeRequestId, excludeRequestId, checkIn, checkOut],
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
      AND ? <= check_out_date
      AND ? > check_in_date
    LIMIT 1
  `;
  pool.query(
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

  // 1) property lookup
  const propSql = `
    SELECT property_id, owner_id, price_per_day, price_value, pricing_unit, is_available, is_verified, property_name
    FROM property
    WHERE property_id = ?
    LIMIT 1
  `;
  pool.query(propSql, [property_id], (err, props) => {
    if (err) {
      console.error("❌ DB error (property lookup):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (props.length === 0) {
      return res.status(404).json({ msg: "property not found" });
    }

    const property = props[0];

    if (property.owner_id === renterId) {
      return res.status(400).json({ msg: "You can't rent your own property" });
    }
    if (property.is_available === 0) {
      return res.status(409).json({ msg: "property is not available for renting right now" });
    }
    if (property.is_verified == false) {
      return res.status(400).json({ msg: "property is not verified" });
    }

    // Acquire a dedicated connection for the transaction
    pool.getConnection((poolErr, conn) => {
      if (poolErr) {
        console.error("❌ DB error (getConnection):", poolErr);
        return res.status(500).json({ msg: "Database connection error" });
      }

      conn.beginTransaction(transErr => {
        if (transErr) {
          conn.release();
          return res.status(500).json({ msg: "Database error starting transaction." });
        }

        const rollbackAndRelease = (statusCode, msg) => {
          conn.rollback(() => {
            conn.release();
            return res.status(statusCode).json({ msg });
          });
        };

        // 2) property availability check (inside transaction)
        hasOverlap(
          property.property_id,
          check_in_date,
          check_out_date,
          null, // No request ID to exclude yet
          (err, overlap) => {
            if (err) {
              return rollbackAndRelease(500, "Database error during overlap check.");
            }
            if (overlap) {
              return rollbackAndRelease(409, "property already reserved for these dates");
            }

            // 3) Idempotency check (inside transaction)
            hasDuplicateRequest(
              renterId,
              property.property_id,
              check_in_date,
              check_out_date,
              (err, exists) => {
                if (err) {
                  return rollbackAndRelease(500, "Database error during duplicate check.");
                }
                if (exists) {
                  return rollbackAndRelease(409, "You already have an active rent request for this property and date range");
                }

                // 4) Calculate price
                let totalPrice;
                if (renting_type === "DAY") {
                  if (!["DAY", "MONTH", "YEAR"].includes(property.pricing_unit)) {
                    conn.rollback(() => { conn.release(); });
                    return res.status(400).json({ msg: "This property is not available for daily rent." });
                  }
                  const days = Math.round((new Date(check_out_date) - new Date(check_in_date)) / (1000 * 60 * 60 * 24));
                  if(days <= 0) {
                    conn.rollback(() => { conn.release(); });
                    return res.status(400).json({ msg: "Invalid date range" });
                  }
                  
                  const pricePerDay = Number(property.price_per_day);
                  if (!pricePerDay || pricePerDay <= 0) {
                    conn.rollback(() => { conn.release(); });
                    return res.status(400).json({ msg: "property price_per_day is invalid" });
                  }
                  
                  totalPrice = Number((pricePerDay * days).toFixed(2));
                  insertRentRequest(totalPrice);
                } else { // MONTH
                    if (property.pricing_unit !== "MONTH") {
                      conn.rollback(() => { conn.release(); });
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

                  conn.query(insertSql, [requestId, property.property_id, renterId, renting_type, totalPrice, check_in_date, check_out_date], (err) => {
                    if (err) {
                      return rollbackAndRelease(500, "Database error creating request.");
                    }

                    // If all goes well, commit the transaction
                    conn.commit(commitErr => {
                      if (commitErr) {
                        return rollbackAndRelease(500, "Database error committing transaction.");
                      }

                      // Release the connection after successful commit
                      conn.release();

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
  });
};

const getRentRequestById = (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ msg: "id is required or not valid" });
  }

  pool.query(
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
 * Uses a transaction with SELECT ... FOR UPDATE to prevent race conditions.
 */
const acceptRentRequest = (req, res) => {
  const landlordId = req.user.userId;
  const requestId = req.params.id;

  pool.getConnection((poolErr, conn) => {
    if (poolErr) {
      console.error("❌ DB error (getConnection):", poolErr);
      return res.status(500).json({ msg: "Database connection error" });
    }

    conn.beginTransaction((transErr) => {
      if (transErr) {
        conn.release();
        return res.status(500).json({ msg: "Database error starting transaction." });
      }

      const rollbackAndRelease = (statusCode, msg) => {
        conn.rollback(() => {
          conn.release();
          return res.status(statusCode).json({ msg });
        });
      };

      // Lock the property row + fetch rent request inside the transaction
      const lockSql = `
        SELECT rr.request_id, rr.property_id, rr.renter_id, rr.request_state,
               rr.check_in_date, rr.check_out_date,
               p.owner_id
        FROM renting_request rr
        INNER JOIN property p ON rr.property_id = p.property_id
        WHERE rr.request_id = ?
        LIMIT 1
        FOR UPDATE
      `;
      conn.query(lockSql, [requestId], (err, rows) => {
        if (err) {
          return rollbackAndRelease(500, "Database error during lock.");
        }

        if (rows.length === 0) {
          return rollbackAndRelease(404, "Rent request not found");
        }

        const rr = rows[0];

        if (rr.owner_id !== landlordId) {
          return rollbackAndRelease(403, "Unauthorized");
        }

        if (rr.request_state !== "PENDING") {
          return rollbackAndRelease(409, `Request can't be accepted from state ${rr.request_state}`);
        }

        // Overlap check inside the transaction (sees the locked row)
        const overlapSql = `
          SELECT 1
          FROM renting_request
          WHERE property_id = ?
            AND request_id <> ?
            AND request_state IN ('PENDING', 'ACCEPTED', 'PAID')
            AND ? <= check_out_date
            AND ? > check_in_date
          LIMIT 1
          FOR UPDATE
        `;
        conn.query(overlapSql, [rr.property_id, requestId, rr.check_in_date, rr.check_out_date], (err, overlapRows) => {
          if (err) {
            return rollbackAndRelease(500, "Database error during overlap check.");
          }

          if (overlapRows.length > 0) {
            return rollbackAndRelease(409, "Property already reserved for these dates");
          }

          // Atomic update inside the transaction
          const updateSql = `
            UPDATE renting_request
            SET request_state = 'ACCEPTED'
            WHERE request_id = ? AND request_state = 'PENDING'
          `;
          conn.query(updateSql, [requestId], (err, result) => {
            if (err) {
              return rollbackAndRelease(500, "Database error during accept.");
            }

            if (result.affectedRows === 0) {
              return rollbackAndRelease(409, "Request was already updated (not PENDING anymore)");
            }

            conn.commit((commitErr) => {
              if (commitErr) {
                return rollbackAndRelease(500, "Database error committing transaction.");
              }

              conn.release();

              const notifier = req.app.get("notifier");
              notifier.send({
                sender: landlordId,
                receiver: rr.renter_id,
                type: "RENT_REQUEST_ACCEPTED",
                title: "Request Accepted! 🎉",
                body: "Your rent request for the property has been accepted. You can now proceed to payment.",
                metadata: {
                  request_id: requestId,
                  property_id: rr.property_id,
                  status: "ACCEPTED",
                },
              });

              return res.status(200).json({ msg: "Rent request accepted", request_state: "ACCEPTED" });
            });
          });
        });
      });
    });
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
    JOIN property p ON rr.property_id = p.property_id
    WHERE rr.request_id = ? AND p.owner_id = ? AND rr.request_state = 'PENDING'
  `;

  pool.query(findSql, [requestId, landlordId], (err, rows) => {
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

    pool.query(updateSql, [requestId], (err, result) => {
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
    JOIN property p ON rr.property_id = p.property_id
    WHERE rr.request_id = ? 
      AND rr.renter_id = ? 
      AND rr.request_state IN ('PENDING', 'ACCEPTED')
  `;

  pool.query(findSql, [requestId, renterId], (err, rows) => {
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

    pool.query(updateSql, [requestId], (err, result) => {
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
