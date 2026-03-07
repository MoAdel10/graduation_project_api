const connection = require("../DB");
require("dotenv").config();

const getAllNotifications = (req, res) => {
  const userId = req.user.userId;

  const sql =
    "SELECT * FROM notifications WHERE receiver = ? ORDER BY created_at DESC";
  connection.query(sql, [userId], (error, result) => {
    if (error) {
      console.error("Error fetching notifications:", error);
      return res.status(500).json({ success: false, msg: "Database error" });
    }

    const unreadCount = result.filter((n) => !n.viewed).length;

    res.status(200).json({
      success: true,
      data: {
        unreadCount: unreadCount,
        notifications: result,
      },
    });
  });
};

const getNotificationById = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const sql =
    "SELECT * FROM notifications WHERE receiver = ? AND notification_id = ? LIMIT 1";

  connection.query(sql, [userId, id], (error, result) => {
    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, msg: "Database error" });
    }

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Notification not found or access denied.",
      });
    }

    res.status(200).json({
      success: true,
      data: result[0],
    });
  });
};

const markNotificationAsViewed = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const sql =
    "UPDATE notifications SET viewed = TRUE WHERE receiver = ? AND notification_id = ?";
  connection.query(sql, [userId, id], (error, result) => {
    if (error) {
      console.error(error);
      return res.status(500).json({ success: false, msg: "Database error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        msg: "Notification not found or already updated.",
      });
    }

    res.status(200).json({
      success: true,
      msg: "Notification marked as viewed",
    });
  });
};

module.exports = {
  getAllNotifications,
  getNotificationById,
  markNotificationAsViewed,
};
