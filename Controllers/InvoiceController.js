const pool = require("../DB").promise();

const getRenterInvoices = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.invoice_id, i.lease_id, i.renter_id, i.owner_id, i.amount,
              i.due_date, i.status, i.kashier_order_id, i.paid_at, i.created_at,
              p.property_id, p.property_name, p.location
       FROM invoices i
       JOIN lease l ON i.lease_id = l.lease_id
       JOIN property p ON l.property_id = p.property_id
       WHERE i.renter_id = ?
       ORDER BY i.due_date DESC`,
      [req.user.userId],
    );
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("❌ getRenterInvoices error:", err);
    res.status(500).json({ msg: "Database error" });
  }
};

const getOwnerInvoices = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.invoice_id, i.lease_id, i.renter_id, i.owner_id, i.amount,
              i.due_date, i.status, i.kashier_order_id, i.paid_at, i.created_at,
              p.property_id, p.property_name, p.location
       FROM invoices i
       JOIN lease l ON i.lease_id = l.lease_id
       JOIN property p ON l.property_id = p.property_id
       WHERE p.owner_id = ?
       ORDER BY i.due_date DESC`,
      [req.user.userId],
    );
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("❌ getOwnerInvoices error:", err);
    res.status(500).json({ msg: "Database error" });
  }
};

const getInvoiceStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    const [[renterStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_invoices,
         SUM(CASE WHEN status = 'UNPAID' THEN 1 ELSE 0 END) AS unpaid_count,
         SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END) AS overdue_count,
         SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid_count,
         COALESCE(SUM(CASE WHEN status IN ('UNPAID','OVERDUE') THEN amount ELSE 0 END), 0) AS total_due,
         MIN(CASE WHEN status IN ('UNPAID','OVERDUE') THEN due_date ELSE NULL END) AS next_due_date
       FROM invoices WHERE renter_id = ?`,
      [userId],
    );

    const [[ownerStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total_invoices,
         SUM(CASE WHEN status IN ('UNPAID','OVERDUE') THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid_count,
         COALESCE(SUM(CASE WHEN status IN ('UNPAID','OVERDUE') THEN amount ELSE 0 END), 0) AS expected_income,
         COUNT(DISTINCT CASE WHEN status IN ('UNPAID','OVERDUE') THEN i.renter_id ELSE NULL END) AS delinquent_tenants
       FROM invoices i
       JOIN property p ON i.lease_id IN (SELECT lease_id FROM lease WHERE property_id = p.property_id)
       WHERE p.owner_id = ?`,
      [userId],
    );

    res.status(200).json({
      success: true,
      data: { asRenter: renterStats, asOwner: ownerStats },
    });
  } catch (err) {
    console.error("❌ getInvoiceStats error:", err);
    res.status(500).json({ msg: "Database error" });
  }
};

module.exports = { getRenterInvoices, getOwnerInvoices, getInvoiceStats };
