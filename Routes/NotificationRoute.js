const express = require("express");
const router = express.Router();
const verifyToken = require("../Middleware/verifyToken");
const {getAllNotifications,getNotificationById,markNotificationAsViewed} = require("../Controllers/NotificationController")


router.get("/api/notification",verifyToken,getAllNotifications)
router.get("/api/notification/:id",verifyToken,getNotificationById)
router.put("/api/notification/:id",verifyToken,markNotificationAsViewed)

module.exports = router