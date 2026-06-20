const triggerReverification = (pool, propertyId, userId, callback) => {
  pool.query("SELECT property_type FROM property WHERE property_id = ?", [propertyId], (err, results) => {
    if (err) return callback(err);

    const propertyType = results[0]?.property_type || 'for_rent';
    const isRent = propertyType === 'for_rent';
    const listingStatus = isRent ? 'active' : 'inactive';
    const isAvailable = isRent ? 1 : 0;

    pool.query(
      "UPDATE property SET is_verified = FALSE, is_available = ?, listing_status = ? WHERE property_id = ?",
      [isAvailable, listingStatus, propertyId],
      (err) => {
        if (err) return callback(err);

        pool.query(
          "INSERT INTO verificationrequests (property_id, user_id, status) VALUES (?, ?, 'pending')",
          [propertyId, userId],
          (err) => {
            if (err) return callback(err);
            callback(null);
          }
        );
      }
    );
  });
};

module.exports = triggerReverification;
