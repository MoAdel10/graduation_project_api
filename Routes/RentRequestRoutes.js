const express = require("express");
const router = express.Router();

const verifyToken = require("../Middleware/verifyToken");
const {
  createRentRequest,
  acceptRentRequest,
  rejectRentRequest,
  cancelRentRequest,
} = require("../Controllers/RentRequestController");

// POST /rent-requests (Renter)
router.post("/rent-requests", verifyToken, createRentRequest);

// POST /rent-requests/:id/accept (Landlord)
router.post("/rent-requests/:id/accept", verifyToken, acceptRentRequest);

// POST /rent-requests/:id/reject (Landlord)
router.post("/rent-requests/:id/reject", verifyToken, rejectRentRequest);

// POST /rent-requests/:id/cancel (Renter)
router.post("/rent-requests/:id/cancel", verifyToken, cancelRentRequest);

module.exports = router;
