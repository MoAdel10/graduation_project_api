const express = require("express")
const {SignUp,Login,getUserProfieWithToken,updateUserProfile,Logout,verifyOTP,requestPasswordReset,verifyResetToken,resetPassword} = require("../Controllers/AuthController")
const verifyToken = require("../Middleware/verifyToken")

const route = express.Router()

route.post("/auth/signup",SignUp);
route.post("/auth/login", Login);
route.get("/auth/profile",verifyToken,getUserProfieWithToken);
route.put("/auth/profile", verifyToken, updateUserProfile);
route.post("/auth/logout", verifyToken, Logout);
route.post("/auth/verify-otp", verifyOTP); // ✅ new route
route.post("/auth/request-reset", requestPasswordReset);
route.get("/auth/verify-reset/:token", verifyResetToken);
route.post("/auth/reset-password/:token", resetPassword);

module.exports = route