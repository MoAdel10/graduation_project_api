const express = require("express");
const router = express.Router();
const {sendChatMessage,getInbox,getChatHistory,markAsRead} = require("../Controllers/ChatController");
const verifyToken = require("../Middleware/verifyToken");


router.post("/chat/send", verifyToken, sendChatMessage);
router.get("/chat/inbox",verifyToken, getInbox);
router.get("/chat/history/:chat_id",verifyToken, getChatHistory);
router.patch("/chat/read/:chat_id", verifyToken,markAsRead);
module.exports = router;    