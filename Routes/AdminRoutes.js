const express = require("express");
const router = express.Router();

const { createAdmin, loginAdmin } = require("../Controllers/AdminController");
const { adminAuth, isSuperAdmin } = require("../Middleware/adminAuth");
const { getAllAdmins, getAllUsers, getAllProperties } = require("../Utils/dbutils");

// only super admin can create admins
router.post("/admin/create", adminAuth, isSuperAdmin, createAdmin);

// adding the login for the admin 
router.get("/admin/login", (req, res) => {
  res.render("admin/login"); // views/admin/login.ejs
});

// login (will be used in ejs form)
router.post("/admin/login", loginAdmin);

router.get("/admin/test",adminAuth,(req,res)=>{
  res.render("admin/test",{ admin: req.admin })
})

router.get("/admin/dashboard", adminAuth, async (req, res) => {
  const section = req.query.section || 'admins';

  // fetch data from DB
  const admins = await getAllAdmins();
  const users = await getAllUsers();
  const properties = await getAllProperties();

  res.render("admin/dashboard", {
    admin: req.admin,
    section,
    admins,
    users,
    properties: [{property_id:2,property_name:"test",owner:"test",owner_id:"a3e5a975-d056-11f0-b491-0a002700000c",location:"test",verified:false}]
  });
});


module.exports = router;
