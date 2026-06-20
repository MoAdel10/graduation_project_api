const express = require("express")
const router = express.Router()
const verifyToken = require("../Middleware/verifyToken");
const {GetPaymentLink,KashierWebhook, refundPayment, requestWithdrawal,getUserBalance, getTransactionHistory, requestRefund, cancelRefundRequest, getTransferStatus} = require("../Controllers/PaymentController")
const {adminAuth} = require("../Middleware/adminAuth");



router.post("/api/payment/",verifyToken,GetPaymentLink)
router.post('/payment/webhook', KashierWebhook);
router.post("/payment/refund", adminAuth, refundPayment);
router.post("/api/payment/request-refund", verifyToken, requestRefund);
router.post("/api/payment/cancel-refund-request", verifyToken, cancelRefundRequest);
router.get("/api/payment/transfer-status/:transferId", verifyToken, getTransferStatus);
router.get("/api/payment/transactions", verifyToken, getTransactionHistory);
router.post("/api/payment/request-withdrawal", verifyToken, requestWithdrawal);
router.get("/api/balance", verifyToken,getUserBalance);
module.exports = router