const jwt = require("jsonwebtoken");
require("dotenv").config();

const adminAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ msg: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ msg: "Invalid token" });
  }
};

const isSuperAdmin = (req, res, next) => {
  if (req.admin.role !== "super_admin")
    return res.status(403).json({ msg: "Not allowed" });
  next();
};

module.exports = { adminAuth, isSuperAdmin };