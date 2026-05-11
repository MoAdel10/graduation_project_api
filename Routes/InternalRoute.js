const express = require("express");
const { pulse, getAiPropertiesSync } = require("../Controllers/InternalController");
const internalAuth = require("../Middleware/internalAuth");
const route = express.Router();

// A middleware to protect the internal routes will be needed
// For now, it's open for development purposes

route.post("/internal/pulse", pulse);
route.get("/internal/ai-sync", internalAuth, getAiPropertiesSync);

module.exports = route;
