const express = require("express")
const {SignUp,getUserProfieWithToken} = require("../Controllers/AuthController")
const verifyToken = require("../Middleware/verifyToken")

const route = express.Router()

route.post("/auth/signup",SignUp);
route.get("/auth/profile",verifyToken,getUserProfieWithToken);


module.exports = route