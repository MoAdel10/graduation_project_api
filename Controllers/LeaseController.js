const connection = require("../DB");

const getLeasesAsRenter = (req, res) => {
  const renterId = req.user.userId;

  const sql = "SELECT * FROM lease WHERE renter_id = ? ORDER BY check_in_date DESC";

  connection.query(sql, [renterId], (err, results) => {
    if (err) {
      console.error("❌ DB error (getLeasesAsRenter):", err);
      return res.status(500).json({ msg: "Database error" });
    }
    res.status(200).json({ success: true, data: results });
  });
};

const getLeasesAsOwner = (req, res) => {
  const ownerId = req.user.userId;

  const sql = `SELECT l.*, CONCAT(u.first_name, ' ', u.second_name) AS renter_name
               FROM lease l
               JOIN users u ON l.renter_id = u.user_id
               WHERE l.owner_id = ?
               ORDER BY l.check_in_date DESC`;

  connection.query(sql, [ownerId], (err, results) => {
    if (err) {
      console.error("❌ DB error (getLeasesAsOwner):", err);
      return res.status(500).json({ msg: "Database error" });
    }
    res.status(200).json({ success: true, data: results });
  });
};

const getLeaseById = (req, res) => {
  const { leaseId } = req.params;
  const userId = req.user.userId;

  const sql = `SELECT l.*, p.property_name, p.location, p.images, p.price_value
               FROM lease l
               JOIN property p ON l.property_id = p.property_id
               WHERE l.lease_id = ?`;

  connection.query(sql, [leaseId], (err, results) => {
    if (err) {
      console.error("❌ DB error (getLeaseById):", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ msg: "Lease not found" });
    }

    const lease = results[0];

    if (lease.renter_id !== userId && lease.owner_id !== userId) {
      return res.status(403).json({ msg: "You are not authorized to view this lease" });
    }

    res.status(200).json({ success: true, data: lease });
  });
};

module.exports = {
  getLeasesAsRenter,
  getLeasesAsOwner,
  getLeaseById,
};
