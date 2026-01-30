const express = require("express")
const router = express.Router()
const verifyToken = require("../Middleware/verifyToken");

const {checkVerification} = require("../Controllers/OwnerShipController")

router.get("/property/verfication/status/:id",checkVerification)



module.exports = router