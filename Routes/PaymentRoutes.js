const express = require("express")
const router = express.Router()
const verifyToken = require("../Middleware/verifyToken");
const {GetPaymentLink,KashierWebhook} = require("../Controllers/PaymentController")



router.post("/api/payment/",verifyToken,GetPaymentLink)
router.post('/payment/webhook', KashierWebhook);
module.exports = router