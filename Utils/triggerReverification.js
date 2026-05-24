const triggerReverification = (connection, propertyId, userId, callback) => {
  connection.beginTransaction((err) => {
    if (err) return callback(err);

    // Fetch the property_type first to determine default status and availability
    connection.query("SELECT property_type FROM Property WHERE property_id = ?", [propertyId], (err, results) => {
      if (err) return connection.rollback(() => callback(err));
      
      const propertyType = results[0]?.property_type || 'for_rent';
      const isRent = propertyType === 'for_rent';
      
      // For rent, keep it active and available by default
      const listingStatus = isRent ? 'active' : 'inactive';
      const isAvailable = isRent ? 1 : 0;
      
      const updateSql = `
        UPDATE Property 
        SET is_verified = FALSE, is_available = ?, listing_status = ? 
        WHERE property_id = ?
      `;
      
      connection.query(updateSql, [isAvailable, listingStatus, propertyId], (err) => {
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
  });
};

module.exports = triggerReverification;