class NotificationSystem {
  constructor(io, db) {
    this.io = io; // Receive the ALREADY initialized io instance
    this.db = db; // Receive  DB connection
  }

  async send({ receiver, type, title, body, metadata, sender = "SYSTEM" }) {
    // Prepare data for DB (Convert metadata object to string)
    const metadataString = metadata ? JSON.stringify(metadata) : null;

    const sql = `
      INSERT INTO Notifications 
      (sender, receiver, event_type, notification_title, notification_body, metadata) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    // Database Operation
    this.db.query(
      sql, 
      [sender, receiver, type, title, body, metadataString], 
      (err, result) => {
        if (err) {
          return console.error("❌ DB Notification Error:", err.message);
        }

        console.log("✅ Notification saved to DB:", result.insertId);

        // Socket Operation (Only push if DB save succeeded!)
        try {
          this.io.to(receiver).emit("new_notification", {
            notification_id: result.insertId, // Pass the new ID so frontend can use it
            type,
            title,
            body,
            metadata,
            created_at: new Date()
          });
          console.log(`📡 Signal pushed to room: ${receiver}`);
        } catch (socketErr) {
          console.error("⚠️ Socket push failed, but DB record exists:", socketErr);
        }
      }
    );
  }
}


module.exports = { NotificationSystem };
