const connection = require("../DB");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

require("dotenv").config();

// =============== CREATE ADMIN (Super Admin Only) =================
const createAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ msg: "Email & password required" });

    const hashed = await bcrypt.hash(password, 10);

    const sql = `INSERT INTO Admins (email, password, role) VALUES (?, ?, 'admin')`;

    connection.query(sql, [email, hashed], (err) => {
      if (err) return res.status(500).json({ msg: "DB error", err });
      res.json({ msg: "Admin created successfully" });
    });
  } catch (error) {
    res.status(500).json({ msg: "Server error", error });
  }
};

// ================== ADMIN LOGIN (For EJS Panel) ==================
const loginAdmin = (req, res) => {
  const { email, password } = req.body;

  const sql = `SELECT * FROM Admins WHERE email = ?`;

  connection.query(sql, [email], async (err, result) => {
    if (err) return res.render("admin/login", { error: "Database error" });
    if (!result.length)
      return res.render("admin/login", { error: "Admin not found" });

    const admin = result[0];

    const match = await bcrypt.compare(password, admin.password);
    if (!match)
      return res.render("admin/login", { error: "Invalid credentials" });

    const token = jwt.sign(
      {
        id: admin.admin_id,
        email: admin.email,
        role: admin.role,
      },
      process.env.JWT_SECRET_KEY,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      secure: process.env.STATE != "DEV",
      sameSite: "strict",
    });

    res.redirect("/admin/admins");
  });
};

module.exports = {
  createAdmin,
  loginAdmin,
};
