const express = require("express");
const verifyToken = require("../Middleware/verifyToken");
const {SendPromotionRequest,SponsorshipWebhook} = require("../Controllers/SponserController")

const route = express.Router();

route.post("/api/sponser",verifyToken,SendPromotionRequest);
route.post('/api/sponser/webhook', SponsorshipWebhook);
module.exports = route;
