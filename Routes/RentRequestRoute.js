const express = require("express")
const verifyToken = require("../Middleware/verifyToken")
const {getRentRequests,getRentRequestById} = require("../Controllers/RentRequestController")
const route = express.Router()


route.get("/rent-requests",verifyToken,getRentRequests)
route.get("/rent-requests/:id",getRentRequestById)

module.exports = route