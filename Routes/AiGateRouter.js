const express = require("express");
const { pulse, getAiPropertiesSync } = require("../Controllers/AiGateController");
const internalAuth = require("../Middleware/AiAuth");
const route = express.Router();

route.get("/internal/pulse", pulse);
route.get("/internal/ai-sync", internalAuth, getAiPropertiesSync);

module.exports = route;