const express = require('express');
const router = express.Router();
const purchaseRequestController = require('../Controllers/PurchaseRequestController');
const verifyToken = require('../Middleware/verifyToken');

// Send a purchase request (Rate limited)
router.post('/', verifyToken, purchaseRequestController.sendPurchaseRequest);

// Get all requests made by the current user (buyer)
router.get('/my', verifyToken, purchaseRequestController.getMyRequests);

// Get all requests received for the current user's properties (seller)
router.get('/received', verifyToken, purchaseRequestController.getRequestsForMyProperties);

// Seller accepts or rejects a request
router.put('/:id', verifyToken, purchaseRequestController.updateRequestStatus);

// Buyer cancels their own pending request
router.put('/:id/cancel', verifyToken, purchaseRequestController.cancelRequest);

// Seller marks their property as sold
router.post('/property/:property_id/sold', verifyToken, purchaseRequestController.markPropertyAsSold);

module.exports = router;
