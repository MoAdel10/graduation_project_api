const connection = require("../DB");
const crypto = require("crypto");

// Helper: validate YYYY-MM-DD dates + basic ordering
function validateDateRange(checkIn, checkOut) {
  if (!checkIn || !checkOut) return { ok: false, msg: "check_in_date and check_out_date are required" };

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
  connection.query(sql, [propertyId, excludeRequestId, checkIn, checkOut], (err, rows) => {
    if (err) return cb(err);
    cb(null, rows.length > 0);
  });
}

/**
 * POST /rent-requests
 * Who: Renter
 */
const createRentRequest = (req, res) => {
  const renterId = req.user.userId;
  const { property_id, check_in_date, check_out_date } = req.body;

  if (!property_id || !check_in_date || !check_out_date) {
    return res.status(400).json({ msg: "property_id, check_in_date, check_out_date are required" });
  }

  const dateCheck = validateDateRange(check_in_date, check_out_date);
  if (!dateCheck.ok) return res.status(400).json({ msg: dateCheck.msg });

  // 1) property exists + owner + price + is_available
  const propSql = `
    SELECT property_id, owner_id, price_per_day, is_available
    FROM Property
    WHERE property_id = ?
    LIMIT 1
  `;
  connection.query(propSql, [property_id], (err, props) => {
    if (err) {
      console.error("❌ DB error (property lookup):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (props.length === 0) return res.status(404).json({ msg: "Property not found" });

    const property = props[0];

    // renter != owner
    if (property.owner_id === renterId) {
      return res.status(400).json({ msg: "You can't rent your own property" });
    }

    // optional: must be listed/available (NOT date booking)
    if (property.is_available === 0) {
      return res.status(409).json({ msg: "Property is not available for renting right now" });
    }

    // 2) date-aware overlap check against ACCEPTED/PAID
    hasOverlap(property.property_id, check_in_date, check_out_date, "___no_id___", (err, overlap) => {
      if (err) {
        console.error("❌ DB error (overlap check):", err);
        return res.status(500).json({ msg: "Database error" });
      }
      if (overlap) {
        return res.status(409).json({ msg: "Property not available for the selected dates" });
      }

      // 3) compute total_price = days * price_per_day
      const daysSql = `SELECT DATEDIFF(?, ?) AS days`;
      connection.query(daysSql, [check_out_date, check_in_date], (err, diffRows) => {
        if (err) {
          console.error("❌ DB error (datediff):", err);
          return res.status(500).json({ msg: "Database error" });
        }

        const days = diffRows[0]?.days;
        if (!days || days <= 0) {
          return res.status(400).json({ msg: "Invalid date range" });
        }

        const pricePerDay = Number(property.price_per_day);
        if (!pricePerDay || pricePerDay <= 0) {
          return res.status(400).json({ msg: "Property price_per_day is invalid" });
        }

        const totalPrice = Number((pricePerDay * days).toFixed(2));

        // 4) insert rent request
        const requestId = crypto.randomUUID();

        const insertSql = `
          INSERT INTO renting_request
            (request_id, property_id, renter_id, request_state, total_price, check_in_date, check_out_date)
          VALUES
            (?, ?, ?, 'PENDING', ?, ?, ?)
        `;
        const values = [
          requestId,
          property.property_id,
          renterId,
          totalPrice,
          check_in_date,
          check_out_date,
        ];

        connection.query(insertSql, values, (err) => {
          if (err) {
            console.error("❌ DB error (insert renting_request):", err);
            return res.status(500).json({ msg: "Database error" });
          }

          return res.status(201).json({
            msg: "Rent request created",
            request_id: requestId,
            request_state: "PENDING",
            total_price: totalPrice,
          });
        });
      });
    });
  });
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

    if (rows.length === 0) return res.status(404).json({ msg: "Rent request not found" });

    const rr = rows[0];

    // ownership
    if (rr.owner_id !== landlordId) {
      return res.status(403).json({ msg: "Unauthorized" });
    }

    // must be pending
    if (rr.request_state !== "PENDING") {
      return res.status(409).json({ msg: `Request can't be accepted from state ${rr.request_state}` });
    }

    // (recommended) re-check overlap before accept to avoid double-booking
    hasOverlap(rr.property_id, rr.check_in_date, rr.check_out_date, rr.request_id, (err, overlap) => {
      if (err) {
        console.error("❌ DB error (accept overlap):", err);
        return res.status(500).json({ msg: "Database error" });
      }
      if (overlap) {
        return res.status(409).json({ msg: "Property already reserved for these dates" });
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
          return res.status(409).json({ msg: "Request was already updated (not PENDING anymore)" });
        }

        return res.status(200).json({ msg: "Rent request accepted", request_state: "ACCEPTED" });
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

  // One atomic update with JOIN to enforce ownership + pending
  const sql = `
    UPDATE renting_request rr
    INNER JOIN Property p ON rr.property_id = p.property_id
    SET rr.request_state = 'REJECTED'
    WHERE rr.request_id = ?
      AND rr.request_state = 'PENDING'
      AND p.owner_id = ?
  `;

  connection.query(sql, [requestId, landlordId], (err, result) => {
    if (err) {
      console.error("❌ DB error (reject):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: "Request not found, not pending, or not owned by you" });
    }

    return res.status(200).json({ msg: "Rent request rejected", request_state: "REJECTED" });
  });
};

/**
 * POST /rent-requests/:id/cancel
 * Who: Renter
 */
const cancelRentRequest = (req, res) => {
  const renterId = req.user.userId;
  const requestId = req.params.id;

  // Only renter can cancel, and only from PENDING/ACCEPTED
  const sql = `
    UPDATE renting_request
    SET request_state = 'CANCELLED'
    WHERE request_id = ?
      AND renter_id = ?
      AND request_state IN ('PENDING', 'ACCEPTED')
  `;

  connection.query(sql, [requestId, renterId], (err, result) => {
    if (err) {
      console.error("❌ DB error (cancel):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: "Request not found, not yours, or can't be cancelled now" });
    }

    return res.status(200).json({ msg: "Rent request cancelled", request_state: "CANCELLED" });
  });
};

module.exports = {
  createRentRequest,
  acceptRentRequest,
  rejectRentRequest,
  cancelRentRequest,
};
