const triggerReverification = (connection, propertyId, userId, callback) => {
  connection.beginTransaction((err) => {
    if (err) return callback(err);

   
    const updateSql = "UPDATE Property SET is_verified = FALSE WHERE property_id = ?";
    
    connection.query(updateSql, [propertyId], (err) => {
      if (err) return connection.rollback(() => callback(err));

      
      const requestSql = `
        INSERT INTO VerificationRequests (property_id, user_id, status) 
        VALUES (?, ?, 'pending')
      `;

      connection.query(requestSql, [propertyId, userId], (err) => {
        if (err) return connection.rollback(() => callback(err));

        connection.commit((err) => {
          if (err) return connection.rollback(() => callback(err));
          callback(null); 
        });
      });
    });
  });
};

module.exports = triggerReverification