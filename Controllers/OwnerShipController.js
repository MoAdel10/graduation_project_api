const pool = require("../DB");
require("dotenv").config();

// 1. Admin checks the status of a specific property
const checkVerification = (req, res) => {
  const { id } = req.params;

  if (!id) return res.status(400).json({ msg: "Error: id is needed" });

  pool.query(
    "SELECT is_verified FROM property WHERE property_id = ?",
    [id],
    (err, result) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      if (result.length === 0) return res.status(404).json({ msg: "Property not found" });

      res.status(200).json({ is_verified: !!result[0].is_verified });
    }
  );
};

const resolveVerification = (req, res) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body;
  const adminId = req.admin.admin_id;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ msg: "Invalid status. Use 'approved' or 'rejected'." });
  }

  pool.query(
    "SELECT property_id FROM verificationrequests WHERE request_id = ?",
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      if (rows.length === 0) return res.status(404).json({ msg: "Request not found" });

      const propertyId = rows[0].property_id;
      const isVerified = (status === 'approved' ? 1 : 0);

      pool.query(
        "UPDATE verificationrequests SET status = ?, rejection_reason = ?, admin_id = ? WHERE request_id = ?",
        [status, rejectionReason || null, adminId, id],
        (err) => {
          if (err) return res.status(500).json({ msg: "Failed to update request" });

          pool.query(
            "UPDATE property SET is_verified = ? WHERE property_id = ?",
            [isVerified, propertyId],
            (err) => {
              if (err) return res.status(500).json({ msg: "Failed to update property" });
              res.status(200).json({ msg: `Property has been ${status}` });
            }
          );
        }
      );
    }
  );
};

module.exports = { checkVerification, resolveVerification };
