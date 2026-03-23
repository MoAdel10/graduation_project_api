class ChatSystem {
  constructor(io, db) {
    this.io = io;
    this.db = db;
  }

  async getOrCreateChat(sender_id, receiver_id, property_id) {
    return new Promise((resolve, reject) => {
      const getOwnerSql = `SELECT owner_id FROM Property WHERE property_id = ?`;

      this.db.query(getOwnerSql, [property_id], (err, propResults) => {
        if (err) return reject(err);
        if (propResults.length === 0)
          return reject(new Error("Property not found"));

        const actualOwnerId = propResults[0].owner_id;
        const actualRenterId =
          sender_id === actualOwnerId ? receiver_id : sender_id;

        const findSql = `SELECT chat_id FROM Chats WHERE owner_id = ? AND renter_id = ? AND property_id = ?`;

        this.db.query(
          findSql,
          [actualOwnerId, actualRenterId, property_id],
          (err, results) => {
            if (err) return reject(err);

            if (results.length > 0) {
              return resolve(results[0].chat_id);
            }

            const insertSql = `INSERT INTO Chats (owner_id, renter_id, property_id) VALUES (?, ?, ?)`;
            this.db.query(
              insertSql,
              [actualOwnerId, actualRenterId, property_id],
              (err, res) => {
                if (err) {
                  if (err.code === "ER_DUP_ENTRY") {
                    return this.db.query(
                      findSql,
                      [actualOwnerId, actualRenterId, property_id],
                      (e, r) => {
                        if (e) return reject(e);
                        resolve(r[0].chat_id);
                      },
                    );
                  }
                  return reject(err);
                }

                this.db.query(
                  findSql,
                  [actualOwnerId, actualRenterId, property_id],
                  (err, newRow) => {
                    if (err) return reject(err);
                    resolve(newRow[0].chat_id);
                  },
                );
              },
            );
          },
        );
      });
    });
  }

  async sendMessage(chat_id, sender_id, receiver_id, content) {
    return new Promise((resolve, reject) => {
      const sql = `INSERT INTO Messages (chat_id, sender_id, content) VALUES (?, ?, ?)`;
      this.db.query(sql, [chat_id, sender_id, content], (err, res) => {
        if (err) return reject(err);

        const payload = {
          chat_id,
          sender_id,
          content,
          created_at: new Date(),
        };

        // Emit to both parties in their private rooms
        this.io.to(sender_id).to(receiver_id).emit("new_chat_message", payload);

        resolve(payload);
      });
    });
  }
}

module.exports = { ChatSystem };
