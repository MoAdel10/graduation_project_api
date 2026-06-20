const connection = require("../DB");

const sendChatMessage = async (req, res) => {
  const { receiver_id, property_id, content } = req.body;
  const sender_id = req.user?.userId;

  if (!sender_id || !receiver_id || !property_id) {
    return res.status(400).json({
      status: "error",
      message:
        "Missing required fields: receiver_id, property_id, or user authentication.",
    });
  }

  const chatManager = req.app.get("chatManager");

  try {
    const chat_id = await chatManager.getOrCreateChat(
      receiver_id,
      sender_id,
      property_id,
    );

    // Save and Emit message
    const message = await chatManager.sendMessage(
      chat_id,
      sender_id,
      receiver_id,
      property_id,
      content,
    );

    res.status(200).json({ status: "success", data: message });
  } catch (error) {
    console.error("❌ Chat Controller Error:", error);
    res
      .status(500)
      .json({
        status: "error",
        message: error.sqlMessage || "Failed to send message",
      });
  }
};

// Get all conversations for the logged-in user (Inbox)
const getInbox = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res
      .status(401)
      .json({ status: "error", message: "User not authenticated." });
  }

  const sql = `
    SELECT 
      c.chat_id,
      c.property_id,
      p.property_name,
      p.images AS property_images,
      CONCAT(u.first_name, ' ', u.second_name) AS partner_name,
      u.user_id AS partner_id,
      m.content AS last_message,
      m.created_at AS last_message_time,
      (SELECT COUNT(*) FROM messages WHERE chat_id = c.chat_id AND is_read = 0 AND sender_id != ?) AS unread_count,
      NOT p.is_visible AS is_property_deleted
    FROM chats c
    JOIN property p ON c.property_id = p.property_id
    JOIN users u ON u.user_id = IF(c.owner_id = ?, c.renter_id, c.owner_id)
    LEFT JOIN messages m ON m.message_id = (
      SELECT message_id FROM messages 
      WHERE chat_id = c.chat_id 
      ORDER BY created_at DESC LIMIT 1
    )
    WHERE c.owner_id = ? OR c.renter_id = ?
    ORDER BY m.created_at DESC;
  `;

  try {
    connection.query(sql, [userId, userId, userId, userId], (err, results) => {
      if (err) {
        console.error("❌ SQL Query Error:", err);
        return res
          .status(500)
          .json({ status: "error", message: "Database query failed." });
      }
      res.status(200).json({ status: "success", data: results });
    });
  } catch (error) {
    console.error("❌ Inbox Error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch inbox." });
  }
};

// Get message history for a specific chat
const getChatHistory = async (req, res) => {
  const { chat_id } = req.params;
  const userId = req.user?.userId;

  if (!chat_id || !userId) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing chat ID or authentication." });
  }

  const sql = `
    SELECT message_id, sender_id, content, is_read, created_at 
    FROM messages 
    WHERE chat_id = ? 
    ORDER BY created_at ASC
  `;

  try {
    connection.query(sql, [chat_id], (err, results) => {
      if (err) throw err;
      res.status(200).json({ status: "success", data: results });
    });
  } catch (error) {
    console.error("❌ History Error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Failed to fetch chat history." });
  }
};

// Mark messages in a chat as read
const markAsRead = async (req, res) => {
  const { chat_id } = req.params;
  const userId = req.user?.userId;

  if (!chat_id || !userId) {
    return res
      .status(400)
      .json({ status: "error", message: "Missing required information." });
  }

  // Mark messages as read ONLY if the current user is the receiver (sender_id != userId)
  const sql = `UPDATE messages SET is_read = 1 WHERE chat_id = ? AND sender_id != ?`;

  try {
    connection.query(sql, [chat_id, userId], (err, result) => {
      if (err) throw err;
      res
        .status(200)
        .json({ status: "success", message: "Messages marked as read." });
    });
  } catch (error) {
    console.error("❌ MarkRead Error:", error);
    res
      .status(500)
      .json({ status: "error", message: "Failed to update read status." });
  }
};

module.exports = {
  sendChatMessage,
  getInbox,
  getChatHistory,
  markAsRead,
};
