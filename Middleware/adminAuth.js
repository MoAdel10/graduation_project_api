const jwt = require("jsonwebtoken");
require("dotenv").config();



const adminAuth = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) return res.redirect("/admin/login");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    req.admin = decoded; 
    next();
  } catch (err) {
    return res.redirect("/admin/login");
  }
};

module.exports = { adminAuth };


const isSuperAdmin = (req, res, next) => {
  if (req.admin.role !== "super_admin")
    return res.status(403).json({ msg: "Not allowed" });
  next();
};

module.exports = { adminAuth, isSuperAdmin };