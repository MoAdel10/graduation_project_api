const express = require("express")
const {SignUp,Login,getUserProfieWithToken,updateUserProfile,Logout} = require("../Controllers/AuthController")
const verifyToken = require("../Middleware/verifyToken")

const route = express.Router()

route.post("/auth/signup",SignUp);
route.post("/auth/login", Login);
route.get("/auth/profile",verifyToken,getUserProfieWithToken);
route.put("/auth/profile", verifyToken, updateUserProfile);
route.post("/auth/logout", verifyToken, Logout);


module.exports = route