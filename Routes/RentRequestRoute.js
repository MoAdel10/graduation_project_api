const express = require("express");
const verifyToken = require("../Middleware/verifyToken");
const {
  getRentRequests,
  getRentRequestById,
  createRentRequest,
  acceptRentRequest,
  rejectRentRequest,
  cancelRentRequest,
} = require("../Controllers/RentRequestController");
const route = express.Router();


route.get("/rent-requests", verifyToken, getRentRequests);
route.get("/rent-requests/:id", getRentRequestById);
// POST /rent-requests (Renter)
route.post("/rent-requests", verifyToken, createRentRequest);

// POST /rent-requests/:id/accept (Landlord)
route.post("/rent-requests/:id/accept", verifyToken, acceptRentRequest);

// POST /rent-requests/:id/reject (Landlord)
route.post("/rent-requests/:id/reject", verifyToken, rejectRentRequest);

// POST /rent-requests/:id/cancel (Renter)
route.post("/rent-requests/:id/cancel", verifyToken, cancelRentRequest);

module.exports = route;
