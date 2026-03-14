const express = require("express");
const verifyToken = require("../Middleware/verifyToken");
const {
  getLeasesAsRenter,
  getLeasesAsOwner,
  getLeaseById,
} = require("../Controllers/LeaseController");
const route = express.Router();

route.get("/leases/renter", verifyToken, getLeasesAsRenter);
route.get("/leases/owner", verifyToken, getLeasesAsOwner);
route.get("/leases/:leaseId", verifyToken, getLeaseById);

module.exports = route;
