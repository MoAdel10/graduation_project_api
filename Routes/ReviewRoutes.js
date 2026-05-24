const express = require("express");
const router = express.Router();
const verifyToken = require("../Middleware/verifyToken");
const { getReviews, addReview } = require("../Controllers/ReviewController");

// Fetch reviews (GET /Reviews or GET /reviews)
router.get("/Reviews", getReviews);
router.get("/reviews", getReviews);

// Add review (POST /review or POST /reviews)
router.post("/review", verifyToken, addReview);
router.post("/reviews", verifyToken, addReview);

module.exports = router;
