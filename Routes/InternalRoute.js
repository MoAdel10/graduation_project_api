const express = require("express");
const { pulse } = require("../Controllers/InternalController");
const route = express.Router();

// A middleware to protect the internal routes will be needed
// For now, it's open for development purposes

route.post("/internal/pulse", pulse);

module.exports = route;
