const connection = require("../DB");
require("dotenv").config();

// 1. Admin checks the status of a specific property
const checkVerification = (req, res) => {
  const { id } = req.params;

  if (!id) return res.status(400).json({ msg: "Error: id is needed" });

  connection.query(
    "SELECT is_verified FROM Property WHERE property_id = ?",
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

  connection.beginTransaction((err) => {
    if (err) return res.status(500).json({ msg: "Transaction Error" });

    // Step A: Update history/request table
    const sqlRequest = `
      UPDATE VerificationRequests 
      SET status = ?, rejection_reason = ?, admin_id = ? 
      WHERE request_id = ?
    `;
    
    connection.query(sqlRequest, [status, rejectionReason || null, adminId, id], (err) => {
      if (err) return connection.rollback(() => res.status(500).json({ msg: "Failed to update request" }));

      // Step B: Get the property_id linked to this request
      connection.query("SELECT property_id FROM VerificationRequests WHERE request_id = ?", [id], (err, rows) => {
        if (err || rows.length === 0) {
          return connection.rollback(() => res.status(404).json({ msg: "Request not found" }));
        }

        const propertyId = rows[0].property_id;
        const isVerified = (status === 'approved' ? 1 : 0);

        // Step C: Update the actual Property status
        connection.query("UPDATE Property SET is_verified = ? WHERE property_id = ?", [isVerified, propertyId], (err) => {
          if (err) return connection.rollback(() => res.status(500).json({ msg: "Failed to update property" }));

          connection.commit((err) => {
            if (err) return connection.rollback(() => res.status(500).json({ msg: "Commit error" }));
            res.status(200).json({ msg: `Property has been ${status}` });
          });
        });
      });
    });
  });
};

module.exports = { checkVerification, resolveVerification };