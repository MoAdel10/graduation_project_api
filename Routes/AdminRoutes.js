const express = require("express");
const router = express.Router();
const connection = require("../DB");

const { createAdmin, loginAdmin } = require("../Controllers/AdminController");
const { adminAuth, isSuperAdmin } = require("../Middleware/adminAuth");
const {
  getAllAdmins,
  getAllUsers,
  getAllProperties,
  getAllVerifcationRequests,
  getProperty,
  getLatestRequestIDByProperty,
} = require("../Utils/dbutils");

// Auth Routes
router.get("/admin/login", (req, res) => res.render("admin/login"));
router.post("/admin/login", loginAdmin);

// Logout Route
router.get("/admin/logout", (req, res) => {
  res.clearCookie("token");
  if (req.session) {
    req.session.destroy();
  }
  res.redirect("/admin/login");
});

// Section Routes
router.get("/admin/admins", adminAuth, isSuperAdmin, async (req, res) => {
  const admins = await getAllAdmins();
  res.render("admin/admins", { admin: req.admin, admins });
});

router.get("/admin/users", adminAuth, async (req, res) => {
  const users = await getAllUsers();
  res.render("admin/users", { admin: req.admin, users });
});

router.get("/admin/properties", adminAuth, async (req, res) => {
  const properties = await getAllProperties();
  res.render("admin/properties", { admin: req.admin, properties });
});

router.get("/admin/verification/requests", adminAuth, async (req, res) => {
  const requests = await getAllVerifcationRequests();
  res.render("admin/verification_requests", { admin: req.admin, requests });
});

// Create Admin (API)
router.post("/admin/create", adminAuth, isSuperAdmin, createAdmin);

router.get(
  "/admin/properties/view/details/:property_id",
  adminAuth,
  async (req, res) => {
    try {
      const { property_id } = req.params;

      // Fetch property details
      const results = await getProperty(property_id); // Your existing getProperty(id) function

      if (results.length === 0) {
        return res.status(404).send("Property not found");
      }

      const property = results[0];

        // Check if there's a pending request for this property to show the Approve/Reject buttons
        connection.query(
            "SELECT request_id FROM verificationrequests WHERE property_id = ? AND status = 'pending' LIMIT 1",
            [property_id],
            (err, requestResults) => {
                const request_id = requestResults.length > 0 ? requestResults[0].request_id : null;
                
                // Render the same view_property.ejs, passing the request_id if it exists
                res.render("admin/view_property", { 
                    admin: req.admin, 
                    property: { ...property, request_id } 
                });
            }
        );
    } catch (error) {
      console.error(error);
      res.status(500).send("Error loading property");
    }
  },
);

router.get("/admin/properties/view/:id", adminAuth, async (req, res) => {
  try {
    const results = await getProperty(req.params.id);

    if (results.length === 0) {
      return res.status(404).send("property not found");
    }

    const property = results[0];
    property.request_id = await getLatestRequestIDByProperty(
      property.property_id,
    );

    if (typeof property.images === "string") {
      property.images = JSON.parse(property.images);
    }

    res.render("admin/view_property", { admin: req.admin, property });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

router.post(
  "/admin/verification/approve/:request_id",
  adminAuth,
  async (req, res) => {
    const { request_id } = req.params;
    const admin_id = req.admin.admin_id;
    const notifier = req.app.get("notifier");

    connection.getConnection((connErr, conn) => {
      if (connErr) return res.status(500).send("Transaction Error");

      conn.beginTransaction(async (err) => {
        if (err) { conn.release(); return res.status(500).send("Transaction Error"); }

        try {
          const [request] = await new Promise((resolve, reject) => {
            conn.query(
              "SELECT v.property_id, v.user_id, v.status, p.property_type FROM verificationrequests v JOIN property p ON v.property_id = p.property_id WHERE v.request_id = ?",
              [request_id],
              (e, r) => (e ? reject(e) : resolve(r)),
            );
          });

          if (!request) throw new Error("Request not found");
          if (request.status !== 'pending') throw new Error("Request already processed");
          const property_id = request.property_id;
          const isSale = request.property_type === 'for_sale';

          await new Promise((resolve, reject) => {
            conn.query(
              "UPDATE property SET is_verified = 1, is_available = 1 WHERE property_id = ?",
              [property_id],
              (e) => (e ? reject(e) : resolve()),
            );
          });

          // If the property has a PAID subscription that hasn't expired, restore listing_status to 'active'
          await new Promise((resolve, reject) => {
            conn.query(
              `SELECT ls.status FROM listingsubscriptions ls
               JOIN property p ON p.property_id = ls.property_id
               WHERE ls.property_id = ? AND ls.status = 'PAID'
               AND (p.listing_expiry IS NULL OR p.listing_expiry >= CURDATE())
               LIMIT 1`,
              [property_id],
              (e, r) => (e ? reject(e) : resolve(r)),
            );
          }).then((rows) => {
            if (rows && rows.length > 0) {
              return new Promise((resolve, reject) => {
                conn.query(
                  "UPDATE property SET listing_status = 'active' WHERE property_id = ?",
                  [property_id],
                  (e) => (e ? reject(e) : resolve()),
                );
              });
            }
          });

          await new Promise((resolve, reject) => {
            conn.query(
              "UPDATE verificationrequests SET status = 'approved', admin_id = ? WHERE request_id = ?",
              [admin_id, request_id],
              (e) => (e ? reject(e) : resolve()),
            );
          });

          await new Promise((resolve, reject) => {
            conn.query(
              "UPDATE verificationrequests SET status = 'rejected', rejection_reason = 'Superseded by newer approval' WHERE property_id = ? AND status = 'pending' AND request_id != ?",
              [property_id, request_id],
              (e) => (e ? reject(e) : resolve()),
            );
          });

          conn.commit((err) => {
            if (err) {
              return conn.rollback(() => { conn.release(); throw err; });
            }
            conn.release();
            notifier.send({
              receiver: request.user_id,
              type: "property_acception",
              title: `Congrats Your property`,
              body: isSale ? `Your property listing is now active` : `You can now start renting`,
            });
            res.redirect("/admin/verification/requests");
          });
        } catch (error) {
          conn.rollback(() => {
            conn.release();
            console.error("❌ Approval Error:", error);
            res.status(500).send("Server Error during approval");
          });
        }
      });
    });
  },
);

router.post(
  "/admin/verification/reject/:request_id",
  adminAuth,
  async (req, res) => {
    const { request_id } = req.params;
    const { reason } = req.body;
    const admin_id = req.admin.admin_id;
    const notifier = req.app.get("notifier");

    connection.getConnection((connErr, conn) => {
      if (connErr) return res.status(500).send("Transaction Error");

      conn.beginTransaction(async (err) => {
        if (err) { conn.release(); return res.status(500).send("Transaction Error"); }

        try {
          const [request] = await new Promise((resolve, reject) => {
            conn.query(
              "SELECT property_id, user_id, status FROM verificationrequests WHERE request_id = ?",
              [request_id],
              (e, r) => (e ? reject(e) : resolve(r))
            );
          });

          if (!request) throw new Error("Request not found");
          if (request.status !== 'pending') throw new Error("Request already processed");
          const property_id = request.property_id;

          await new Promise((resolve, reject) => {
            conn.query(
              "UPDATE property SET is_verified = 0 , is_available = 0 WHERE property_id = ?",
              [property_id],
              (e) => (e ? reject(e) : resolve())
            );
          });

          console.log("REJECTED");

          await new Promise((resolve, reject) => {
            conn.query(
              "UPDATE verificationrequests SET status = 'rejected', rejection_reason = ?, admin_id = ? WHERE request_id = ?",
              [reason, admin_id, request_id],
              (e) => (e ? reject(e) : resolve())
            );
          });

          await new Promise((resolve, reject) => {
            conn.query(
              "UPDATE verificationrequests SET status = 'rejected', rejection_reason = ? WHERE property_id = ? AND status = 'pending' AND request_id != ?",
              [`Rejected alongside request ${request_id}: ${reason}`, property_id, request_id],
              (e) => (e ? reject(e) : resolve())
            );
          });

          conn.commit((err) => {
            if (err) return conn.rollback(() => { conn.release(); throw err; });

            conn.release();
            notifier.send({
              receiver: request.user_id,
              type: "property_rejection",
              title: "Property Verification Declined",
              body: `Your property listing verification request was rejected. Reason: ${reason || 'No specific reason provided.'}`,
            });

            res.redirect("/admin/verification/requests");
          });

        } catch (error) {
          conn.rollback(() => {
            conn.release();
            console.error("❌ Rejection Error:", error);
            res.status(500).send("Server Error during rejection");
          });
        }
      });
    });
  },
);

// ─── Refund Request Management ──────────────────────────────────────────────
const pool = require("../DB").promise();
const crypto = require("crypto");
router.get("/admin/refund-requests", adminAuth, async (req, res) => {
  try {
    // Auto-cancel refund requests past check-in date
    await pool.query(
      `UPDATE renting_request
       SET request_state = 'PAID', reason = CONCAT('[AUTO-CANCELLED] ', reason)
       WHERE request_state = 'REFUND_REQUESTED'
         AND check_in_date <= CURDATE()`,
    );

    const [rows] = await pool.query(
      `SELECT rr.request_id, rr.renter_id, rr.total_price, rr.request_state, rr.created_at, rr.reason,
              p.property_id, p.property_name, p.location,
              u.first_name, u.second_name, u.email
       FROM renting_request rr
       JOIN property p ON rr.property_id = p.property_id
       JOIN users u ON rr.renter_id = u.user_id
       WHERE rr.request_state = 'REFUND_REQUESTED'
       ORDER BY rr.created_at DESC`,
    );
    res.render("admin/refund_requests", { admin: req.admin, requests: rows });
  } catch (error) {
    console.error("❌ Error loading refund requests:", error);
    res.status(500).send("Server Error");
  }
});

router.post("/admin/refund-requests/:id/approve", adminAuth, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [results] = await conn.query(
      `SELECT rr.*, p.owner_id, p.property_name
       FROM renting_request rr
       JOIN property p ON rr.property_id = p.property_id
       WHERE rr.request_id = ? AND rr.request_state = 'REFUND_REQUESTED' FOR UPDATE`,
      [id],
    );

    if (results.length === 0) {
      await conn.rollback();
      return res.status(404).send("Refund request not found or already processed");
    }

    const rentRequest = results[0];

    const totalPrice = parseFloat(rentRequest.total_price);
    const commission = parseFloat((totalPrice * 0.02).toFixed(2));
    const ownerEarnings = totalPrice - commission;

    await conn.query(
      "UPDATE users SET balance = balance + ? WHERE user_id = ?",
      [totalPrice, rentRequest.renter_id],
    );

    await conn.query(
      "UPDATE users SET balance = GREATEST(balance - ?, 0) WHERE user_id = ?",
      [ownerEarnings, rentRequest.owner_id],
    );

    await conn.query(
      "UPDATE renting_request SET request_state = 'REFUNDED' WHERE request_id = ?",
      [id],
    );

    await conn.query(
      "UPDATE property SET is_available = TRUE WHERE property_id = ?",
      [rentRequest.property_id],
    );

    await conn.query(
      "UPDATE lease SET status = 'CANCELLED' WHERE request_id = ? AND status NOT IN ('CANCELLED', 'COMPLETED')",
      [id],
    );

    const paymentIntentId = crypto.randomUUID();
    await conn.query(
      `INSERT INTO paymentintents (payment_id, user_id, property_id, payment_type, value, payment_method, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [paymentIntentId, rentRequest.renter_id, rentRequest.property_id, "refund", totalPrice, "wallet", "succeeded"],
    );

    await conn.commit();

    const notifier = req.app.get("notifier");

    notifier.send({
      receiver: rentRequest.renter_id,
      type: "PAYMENT_REFUNDED",
      title: "Refund Approved 🔄",
      body: `Your refund of ${totalPrice} EGP has been approved and credited to your wallet.`,
      metadata: { request_id: id, amount: totalPrice },
    });

    notifier.send({
      receiver: rentRequest.owner_id,
      type: "REFUND_APPROVED",
      title: "Refund Approved",
      body: `The admin has approved the refund for "${rentRequest.property_name}". Your balance has been adjusted and the property is now available.`,
      metadata: { request_id: id, property_name: rentRequest.property_name },
    });

    res.redirect("/admin/refund-requests");
  } catch (error) {
    await conn.rollback();
    console.error("❌ Refund Approval Error:", error);
    res.status(500).send("Server Error during refund approval");
  } finally {
    conn.release();
  }
});

router.post("/admin/refund-requests/:id/deny", adminAuth, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const [rows] = await pool.query(
      "SELECT renter_id FROM renting_request WHERE request_id = ?",
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).send("Request not found");
    }

    await pool.query(
      "UPDATE renting_request SET request_state = 'PAID', denied_at = NOW() WHERE request_id = ?",
      [id],
    );

    req.app.get("notifier").send({
      receiver: rows[0].renter_id,
      type: "REFUND_DENIED",
      title: "Refund Request Denied ❌",
      body: `Your refund request was denied. Reason: ${reason || "No reason provided."} Your payment remains valid and your booking continues normally.`,
      metadata: { request_id: id },
    });

    res.redirect("/admin/refund-requests");
  } catch (error) {
    console.error("❌ Refund Deny Error:", error);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
