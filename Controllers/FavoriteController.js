const connection = require("../DB");

// Helper: Safely parse JSON arrays
function safeParseArray(value) {
  try {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return JSON.parse(value);
  } catch {
    return [];
  }
}

// ---------------------------------------------
// ADD TO FAVORITES
// ---------------------------------------------
const addToFavorites = async (req, res) => {
  const user_id = req.user?.userId;
  const property_id = Number(req.params.apartmentId);

  if (!user_id || isNaN(property_id)) {
    return res.status(400).json({ message: "Invalid or missing user_id/property_id" });
  }

  const getFavoritesQuery = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(getFavoritesQuery, [user_id], (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    let favorites = safeParseArray(results[0].favorites);

    if (!favorites.includes(property_id)) {
      favorites.push(property_id);
    }

    const updateQuery = "UPDATE Users SET favorites = ? WHERE user_id = ?";
    connection.query(updateQuery, [JSON.stringify(favorites), user_id], (err) => {
      if (err) return res.status(500).json({ message: "Database error" });

      res.status(200).json({
        message: "Added to favorites",
        favorites,
      });
    });
  });
};

// ---------------------------------------------
// GET USER FAVORITES
// ---------------------------------------------
const getUserFavorites = async (req, res) => {
  const user_id = req.user?.userId;
  if (!user_id) return res.status(400).json({ message: "Missing user_id" });

  const query = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(query, [user_id], (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    let favorites = safeParseArray(results[0].favorites);
    if (favorites.length === 0)
      return res.status(200).json({ message: "No favorites yet", favorites: [] });

    const placeholders = favorites.map(() => '?').join(',');
    const sql = `SELECT * FROM Property WHERE property_id IN (${placeholders})`;

    connection.query(sql, favorites, (err, properties) => {
      if (err) return res.status(500).json({ message: "Database error" });

      res.status(200).json({
        message: "Favorite apartments retrieved",
        favorites: properties,
      });
    });
  });
};

// ---------------------------------------------
// REMOVE FROM FAVORITES
// ---------------------------------------------
const removeFromFavorites = async (req, res) => {
  const user_id = req.user?.userId;
  const property_id = Number(req.params.apartmentId);

  if (!user_id || isNaN(property_id)) {
    return res.status(400).json({ message: "Invalid or missing user_id/property_id" });
  }

  const getFavoritesQuery = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(getFavoritesQuery, [user_id], (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    let favorites = safeParseArray(results[0].favorites);
    const updatedFavorites = favorites.filter(id => Number(id) !== property_id);

    const updateQuery = "UPDATE Users SET favorites = ? WHERE user_id = ?";
    connection.query(updateQuery, [JSON.stringify(updatedFavorites), user_id], (err) => {
      if (err) return res.status(500).json({ message: "Database error" });

      res.status(200).json({
        message: "Removed from favorites",
        favorites: updatedFavorites,
      });
    });
  });
};

// ---------------------------------------------
// COMPARE FAVORITE PROPERTIES
// ---------------------------------------------
const compareFavoriteProperties = async (req, res) => {
  const { propertyIds } = req.body;
  const user_id = req.user?.userId;

  if (!user_id) {
    return res.status(401).json({ message: "Unauthorized. User ID missing." });
  }

  if (!Array.isArray(propertyIds) || propertyIds.length < 2) {
    return res.status(400).json({
      message: "Please send an array of at least two property IDs.",
    });
  }

  const validIncomingIds = propertyIds
    .map(id => Number(id))
    .filter(id => !isNaN(id));

  if (validIncomingIds.length === 0) {
    return res.status(400).json({ message: "Invalid property IDs." });
  }

  const getFavoritesQuery = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(getFavoritesQuery, [user_id], (err, results) => {
    if (err) return res.status(500).json({ message: "Database error" });
    if (results.length === 0) return res.status(404).json({ message: "User not found" });

    const userFavorites = safeParseArray(results[0].favorites).map(Number);

    const authorizedIds = validIncomingIds.filter(id =>
      userFavorites.includes(id)
    );

    if (authorizedIds.length === 0) {
      return res.status(403).json({
        message: "None of the provided properties are in your favorites.",
      });
    }

    const placeholders = authorizedIds.map(() => '?').join(',');
    const sql = `
      SELECT property_id, property_name, location, price_per_day, size, bedrooms_no, beds_no, bathrooms_no, images
      FROM Property 
      WHERE property_id IN (${placeholders})
    `;

    connection.query(sql, authorizedIds, (err, results) => {
      if (err) return res.status(500).json({ message: "Database error" });

      const properties = results.map(prop => ({
        ...prop,
        images: prop.images || [],
      }));

      res.status(200).json({
        message: "Authorized properties ready for comparison",
        properties,
      });
    });
  });
};

module.exports = {
  addToFavorites,
  getUserFavorites,
  removeFromFavorites,
  compareFavoriteProperties,
};