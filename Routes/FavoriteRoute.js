const express = require("express");
const router = express.Router();
const verifyToken = require("../Middleware/verifyToken");
const {addToFavorites,getUserFavorites,removeFromFavorites,compareFavoriteProperties} = require("../Controllers/FavoriteController")


router.post("/favorites/compare", verifyToken, compareFavoriteProperties);
router.post("/favorites/:apartmentId",verifyToken, addToFavorites);
router.get("/favorites",verifyToken, getUserFavorites);
router.delete("/favorites/:apartmentId",verifyToken, removeFromFavorites);

module.exports = router