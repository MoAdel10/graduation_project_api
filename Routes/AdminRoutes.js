const express = require("express");
const router = express.Router();

const { createAdmin, loginAdmin } = require("../Controllers/AdminController");
const { adminAuth, isSuperAdmin } = require("../Middleware/adminAuth");

// only super admin can create admins
router.post("/admin/create", adminAuth, isSuperAdmin, createAdmin);

// login (will be used in ejs form)
router.post("/admin/login", loginAdmin);

module.exports = router;
