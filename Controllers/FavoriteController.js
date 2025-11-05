const connection = require("../DB");

const addToFavorites = async (req, res) => {
  const user_id = req.user?.userId; 
  const property_id = parseInt(req.params.apartmentId, 10);

  if (!user_id || !property_id) {
    return res.status(400).json({ message: "Missing user_id or property_id" });
  }

  const getFavoritesQuery = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(getFavoritesQuery, [user_id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching favorites:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    let favorites = [];
    try {
      favorites = results[0].favorites ? JSON.parse(results[0].favorites) : [];
    } catch {
      favorites = [];
    }

    // Add property if not already there
    if (!favorites.includes(property_id)) {
      favorites.push(property_id);
    }

    const updateQuery = "UPDATE Users SET favorites = ? WHERE user_id = ?";
    connection.query(updateQuery, [JSON.stringify(favorites), user_id], (err) => {
      if (err) {
        console.error("❌ Error updating favorites:", err);
        return res.status(500).json({ message: "Database error" });
      }

      res.status(200).json({
        message: "✅ Added to favorites",
        favorites,
      });
    });
  });
};

const getUserFavorites = async (req, res) => {
  const user_id = req.user?.userId;

  if (!user_id) {
    return res.status(400).json({ message: "Missing user_id" });
  }

  const query = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(query, [user_id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching favorites:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    let favorites = [];
    try {
      favorites = results[0].favorites ? JSON.parse(results[0].favorites) : [];
    } catch {
      favorites = [];
    }

    if (favorites.length === 0) {
      return res.status(200).json({ message: "No favorites yet", favorites: [] });
    }

    const favoritesQuery = `
      SELECT * FROM Property WHERE property_id IN (${favorites.join(",")})
    `;
    connection.query(favoritesQuery, (err, properties) => {
      if (err) {
        console.error("❌ Error fetching favorite properties:", err);
        return res.status(500).json({ message: "Database error" });
      }

      res.status(200).json({
        message: "✅ Favorite apartments retrieved",
        favorites: properties,
      });
    });
  });
};

const removeFromFavorites = async (req, res) => {
  const user_id = req.user?.userId;
  const property_id = parseInt(req.params.apartmentId, 10);

  if (!user_id || !property_id) {
    return res.status(400).json({ message: "Missing user_id or property_id" });
  }

  const getFavoritesQuery = "SELECT favorites FROM Users WHERE user_id = ?";
  connection.query(getFavoritesQuery, [user_id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching favorites:", err);
      return res.status(500).json({ message: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    let favorites = [];
    try {
      favorites = results[0].favorites ? JSON.parse(results[0].favorites) : [];
    } catch {
      favorites = [];
    }

    // Remove the property ID
    const updatedFavorites = favorites.filter((id) => id !== property_id);

    const updateQuery = "UPDATE Users SET favorites = ? WHERE user_id = ?";
    connection.query(updateQuery, [JSON.stringify(updatedFavorites), user_id], (err) => {
      if (err) {
        console.error("❌ Error updating favorites:", err);
        return res.status(500).json({ message: "Database error" });
      }

      res.status(200).json({
        message: "✅ Removed from favorites",
        favorites: updatedFavorites,
      });
    });
  });
};

module.exports = {
  addToFavorites,
  getUserFavorites,
  removeFromFavorites,
};
