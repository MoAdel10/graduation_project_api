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

    connection.beginTransaction(async (err) => {
      if (err) return res.status(500).send("Transaction Error");

      try {
        const [request] = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT property_id,user_id FROM verificationrequests WHERE request_id = ?",
            [request_id],
            (e, r) => (e ? reject(e) : resolve(r)),
          );
        });

        if (!request) throw new Error("Request not found");
        const property_id = request.property_id;

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE property SET is_verified = 1, is_available = 1 WHERE property_id = ?",
            [property_id],
            (e) => (e ? reject(e) : resolve()),
          );
        });

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE verificationrequests SET status = 'approved', admin_id = ? WHERE request_id = ?",
            [admin_id, request_id],
            (e) => (e ? reject(e) : resolve()),
          );
        });

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE verificationrequests SET status = 'rejected', rejection_reason = 'Superseded by newer approval' WHERE property_id = ? AND status = 'pending' AND request_id != ?",
            [property_id, request_id],
            (e) => (e ? reject(e) : resolve()),
          );
        });

        connection.commit((err) => {
          if (err)
            return connection.rollback(() => {
              throw err;
            });
          notifier.send({
            receiver: request.user_id,
            type: "property_acception",
            title: `Congrats Your property`,
            body: `You can now start renting`,
          });
          res.redirect("/admin/verification/requests");
        });
      } catch (error) {
        connection.rollback(() => {
          console.error("❌ Approval Error:", error);
          res.status(500).send("Server Error during approval");
        });
      }
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

    connection.beginTransaction(async (err) => {
      if (err) return res.status(500).send("Transaction Error");

      try {
        // 🌟 FIX: Added user_id to the SELECT query so the notification system has a receiver
        const [request] = await new Promise((resolve, reject) => {
          connection.query(
            "SELECT property_id, user_id FROM verificationrequests WHERE request_id = ?",
            [request_id],
            (e, r) => (e ? reject(e) : resolve(r))
          );
        });

        if (!request) throw new Error("Request not found");
        const property_id = request.property_id;

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE property SET is_verified = 0 , is_available = 0 WHERE property_id = ?",
            [property_id],
            (e) => (e ? reject(e) : resolve())
          );
        });

        console.log("REJECTED");

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE verificationrequests SET status = 'rejected', rejection_reason = ?, admin_id = ? WHERE request_id = ?",
            [reason, admin_id, request_id],
            (e) => (e ? reject(e) : resolve())
          );
        });

        await new Promise((resolve, reject) => {
          connection.query(
            "UPDATE verificationrequests SET status = 'rejected', rejection_reason = ? WHERE property_id = ? AND status = 'pending' AND request_id != ?",
            [`Rejected alongside request ${request_id}: ${reason}`, property_id, request_id],
            (e) => (e ? reject(e) : resolve())
          );
        });

        connection.commit((err) => {
          if (err) return connection.rollback(() => { throw err; });

          // 🌟 NEW: Send the rejection notification after a successful DB commit
          notifier.send({
            receiver: request.user_id,
            type: "property_rejection",
            title: "Property Verification Declined",
            body: `Your property listing verification request was rejected. Reason: ${reason || 'No specific reason provided.'}`,
          });

          res.redirect("/admin/verification/requests");
        });

      } catch (error) {
        connection.rollback(() => {
          console.error("❌ Rejection Error:", error);
          res.status(500).send("Server Error during rejection");
        });
      }
    });
  },
);

module.exports = router;
