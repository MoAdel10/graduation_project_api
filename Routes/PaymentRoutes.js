const express = require("express")
const router = express.Router()
const verifyToken = require("../Middleware/verifyToken");
const {GetPaymentLink,KashierWebhook, refundPayment, requestWithdrawal} = require("../Controllers/PaymentController")
const {adminAuth} = require("../Middleware/adminAuth");



router.post("/api/payment/",verifyToken,GetPaymentLink)
router.post('/payment/webhook', KashierWebhook);
router.post("/payment/refund", adminAuth, refundPayment);
router.post("/api/payment/request-withdrawal", verifyToken, requestWithdrawal);
module.exports = router