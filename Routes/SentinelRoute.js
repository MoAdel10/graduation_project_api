const express = require("express");
const {runRentalPulse} = require("../Controllers/SentinelController")
const {authSentinel} = require("../Middleware/authSentinel")

const route = express.Router();

route.get("/sentinel/heart-beat",(req,res)=>{
    res.status(200).json({state:"alive"})
})

route.post("/sentinel/scan",authSentinel,runRentalPulse)

module.exports = route;
