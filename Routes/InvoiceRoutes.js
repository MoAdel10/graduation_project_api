const express = require("express");
const router = express.Router();
const verifyToken = require("../Middleware/verifyToken");
const {
  getRenterInvoices,
  getOwnerInvoices,
  getInvoiceStats,
} = require("../Controllers/InvoiceController");

router.get("/api/invoices/renter", verifyToken, getRenterInvoices);
router.get("/api/invoices/owner", verifyToken, getOwnerInvoices);
router.get("/api/invoices/stats", verifyToken, getInvoiceStats);

module.exports = router;
