const connection = require("../DB");

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
        console.error("❌ Error fetching ent request by ID:", err);
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

module.exports = { getRentRequests, getRentRequestById };
