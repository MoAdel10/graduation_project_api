const db = require('../DB');
const { promisify } = require('util');

// Promisify the db.query to use async/await
const query = promisify(db.query).bind(db);


// --- Basic In-Memory Rate Limiter ---
// In a production environment, use a more robust solution like Redis.
const requestTimestamps = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5; // Max 5 requests per user per minute

const rateLimiter = (req, res, next) => {
    const userId = req.user.id;
    const now = Date.now();

    const userTimestamps = requestTimestamps.get(userId) || [];
    const recentTimestamps = userTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);

    if (recentTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
        return res.status(429).json({ message: "Too many requests. Please try again in a minute." });
    }

    recentTimestamps.push(now);
    requestTimestamps.set(userId, recentTimestamps);
    next();
};
// --- End Rate Limiter ---


const sendPurchaseRequest = async (req, res) => {
    const buyer_id = req.user.id;
    const { property_id, message } = req.body;

    if (!property_id) {
        return res.status(400).json({ message: "Property ID is required." });
    }

    try {
        const propertyResults = await query('SELECT owner_id, property_type, listing_status, property_name FROM Property WHERE property_id = ?', [property_id]);

        if (propertyResults.length === 0) {
            return res.status(404).json({ message: "Property not found." });
        }

        const property = propertyResults[0];

        if (property.property_type !== 'for_sale') {
            return res.status(400).json({ message: "This property is not for sale." });
        }

        // CRITICAL: Only allow requests for 'active' properties
        if (property.listing_status !== 'active') {
            return res.status(400).json({ message: `This property is not currently active for sale. Its status is: ${property.listing_status}.` });
        }

        if (buyer_id === property.owner_id) {
            return res.status(400).json({ message: "You cannot send a purchase request for your own property." });
        }

        const newRequest = {
            property_id,
            buyer_id,
            owner_id: property.owner_id,
            message: message || null,
        };
        
        try {
            const result = await query('INSERT INTO PurchaseRequests SET ?', newRequest);
            const notifier = req.app.get("notifier");
            notifier.send({
                sender: buyer_id,
                receiver: property.owner_id,
                event_type: "PURCHASE_REQUEST",
                notification_title: "New Purchase Request 🏠",
                notification_body: `Someone is interested in your property: ${property.property_name}`,
                metadata: { request_id: result.insertId, property_id }
            });
            res.status(201).json({ message: "Purchase request sent successfully." });
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ message: "You have already sent a purchase request for this property." });
            }
            throw err; // Rethrow other errors
        }

    } catch (error) {
        console.error("Unexpected error in sendPurchaseRequest:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

const updateRequestStatus = async (req, res) => {
    const { id: request_id } = req.params;
    const { status } = req.body;
    const seller_id = req.user.id;

    if (!['ACCEPTED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ message: "Invalid status. Must be 'ACCEPTED' or 'REJECTED'." });
    }

    const connection = db; // Using the raw connection for transactions
    await query('START TRANSACTION');

    try {
        // Step 1: Securely fetch the request and lock the row for the update
        const requestResults = await query('SELECT * FROM PurchaseRequests WHERE request_id = ? AND owner_id = ? AND status = "PENDING" FOR UPDATE', [request_id, seller_id]);

        if (requestResults.length === 0) {
            await query('ROLLBACK');
            // Check if the request exists at all to give a more specific error
            const exists = await query('SELECT status FROM PurchaseRequests WHERE request_id = ? AND owner_id = ?', [request_id, seller_id]);
            if(exists.length > 0) {
                return res.status(409).json({ message: `Request cannot be updated. Its current status is: ${exists[0].status}.`});
            }
            return res.status(404).json({ message: "Pending purchase request not found or you are not the owner." });
        }
        const request = requestResults[0];
        const { property_id, buyer_id } = request;

        // --- ACCEPTANCE LOGIC ---
        if (status === 'ACCEPTED') {
            // 1. Update the property status to 'under_negotiation'
            await query("UPDATE Property SET listing_status = 'under_negotiation' WHERE property_id = ? AND listing_status = 'active'", [property_id]);

            // 2. Update the accepted request and unlock contact
            await query("UPDATE PurchaseRequests SET status = 'ACCEPTED', contact_unlocked = TRUE WHERE request_id = ?", [request_id]);
            
            // 3. Find other pending requests for this property
            const otherRequests = await query("SELECT request_id, buyer_id FROM PurchaseRequests WHERE property_id = ? AND request_id != ? AND status = 'PENDING'", [property_id, request_id]);

            // 4. Reject all other pending requests for the same property
            if (otherRequests.length > 0) {
                const otherRequestIds = otherRequests.map(r => r.request_id);
                await query("UPDATE PurchaseRequests SET status = 'REJECTED' WHERE request_id IN (?)", [otherRequestIds]);
            }
            
            // 5. Send notifications
            const notifier = req.app.get("notifier");
            // Notify accepted buyer
            notifier.send({
                sender: seller_id,
                receiver: buyer_id,
                event_type: "REQUEST_ACCEPTED",
                notification_title: "Your Purchase Request was Accepted! 🎉",
                notification_body: "The seller has accepted your request. You can now view their contact details.",
                metadata: { request_id }
            });

            // Notify rejected buyers
            for (const rejectedReq of otherRequests) {
                notifier.send({
                    sender: seller_id,
                    receiver: rejectedReq.buyer_id,
                    event_type: "REQUEST_REJECTED",
                    notification_title: "Update on your purchase request",
                    notification_body: "The property you were interested in is now under negotiation with another buyer.",
                    metadata: { request_id: rejectedReq.request_id }
                });
            }
             res.status(200).json({ message: "Purchase request accepted. All other pending offers have been rejected." });

        // --- REJECTION LOGIC ---
        } else { // status === 'REJECTED'
            await query("UPDATE PurchaseRequests SET status = 'REJECTED' WHERE request_id = ?", [request_id]);
            
            const notifier = req.app.get("notifier");
            notifier.send({
                sender: seller_id,
                receiver: buyer_id,
                event_type: "REQUEST_REJECTED",
                notification_title: "Your Purchase Request was Rejected",
                notification_body: "The seller has declined your purchase request for the property.",
                metadata: { request_id }
            });
            res.status(200).json({ message: "Purchase request rejected." });
        }
        
        await query('COMMIT');

    } catch (error) {
        await query('ROLLBACK');
        console.error("Error during transaction in updateRequestStatus:", error);
        res.status(500).json({ message: "Internal server error during request update." });
    }
};

const cancelRequest = async (req, res) => {
    const { id: request_id } = req.params;
    const buyer_id = req.user.id;

    try {
        // Atomically check status and owner, then update.
        const result = await query("UPDATE PurchaseRequests SET status = 'CANCELLED' WHERE request_id = ? AND buyer_id = ? AND status = 'PENDING'", [request_id, buyer_id]);

        if (result.affectedRows === 0) {
            // Investigate why it failed
            const request = await query('SELECT buyer_id, status FROM PurchaseRequests WHERE request_id = ?', [request_id]);
            if (request.length === 0) {
                return res.status(404).json({ message: "Purchase request not found." });
            }
            if (request[0].buyer_id !== buyer_id) {
                return res.status(403).json({ message: "You are not authorized to cancel this request." });
            }
            if (request[0].status !== 'PENDING') {
                return res.status(409).json({ message: `Cannot cancel request. Its current status is: ${request[0].status}.` });
            }
        }
        res.status(200).json({ message: "Purchase request cancelled successfully." });
    } catch (error) {
        console.error("Unexpected error in cancelRequest:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};


const getMyRequests = async (req, res) => {
    const buyer_id = req.user.id;
    try {
        const queryStr = `
            SELECT pr.request_id, pr.status, pr.message, pr.created_at, pr.contact_unlocked,
                   p.property_id, p.property_name, p.images, p.listing_status,
                   o.first_name as owner_first_name, o.second_name as owner_second_name
            FROM PurchaseRequests pr
            JOIN Property p ON pr.property_id = p.property_id
            JOIN Users o ON pr.owner_id = o.user_id
            WHERE pr.buyer_id = ?
            ORDER BY pr.created_at DESC
        `;
        const results = await query(queryStr, [buyer_id]);
        res.status(200).json(results);
    } catch (error) {
        console.error("Unexpected error in getMyRequests:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

const getRequestsForMyProperties = async (req, res) => {
    const owner_id = req.user.id;
    try {
        const queryStr = `
            SELECT 
                pr.request_id, pr.status, pr.message, pr.created_at, pr.contact_unlocked,
                p.property_id, p.property_name, p.listing_status,
                b.user_id as buyer_id,
                b.first_name as buyer_first_name,
                b.second_name as buyer_second_name,
                b.email as buyer_email
            FROM PurchaseRequests pr
            JOIN Property p ON pr.property_id = p.property_id
            JOIN Users b ON pr.buyer_id = b.user_id
            WHERE pr.owner_id = ?
            ORDER BY pr.created_at DESC
        `;
        const results = await query(queryStr, [owner_id]);
        res.status(200).json(results);
    } catch (error) {
        console.error("Unexpected error in getRequestsForMyProperties:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};

const markPropertyAsSold = async (req, res) => {
    const { property_id } = req.params;
    const owner_id = req.user.id;

    await query('START TRANSACTION');
    try {
        // Step 1: Securely fetch the property and lock the row
        const propertyResults = await query("SELECT listing_status FROM Property WHERE property_id = ? AND owner_id = ? FOR UPDATE", [property_id, owner_id]);

        if (propertyResults.length === 0) {
            await query('ROLLBACK');
            return res.status(404).json({ message: "Property not found or you are not the owner." });
        }
        
        const property = propertyResults[0];
        if (property.listing_status === 'sold') {
            await query('ROLLBACK');
            return res.status(409).json({ message: "This property is already marked as sold." });
        }
        
        // Step 2: Update the property status to 'sold'
        await query("UPDATE Property SET listing_status = 'sold' WHERE property_id = ? AND owner_id = ?", [property_id, owner_id]);
        
        // Step 3: Reject all other pending requests for the same property
        const otherRequests = await query("SELECT request_id, buyer_id FROM PurchaseRequests WHERE property_id = ? AND status = 'PENDING'", [property_id]);
        if (otherRequests.length > 0) {
            const otherRequestIds = otherRequests.map(r => r.request_id);
            await query("UPDATE PurchaseRequests SET status = 'REJECTED' WHERE request_id IN (?)", [otherRequestIds]);
            
            // Step 4: Notify rejected buyers
            const notifier = req.app.get("notifier");
            for (const rejectedReq of otherRequests) {
                notifier.send({
                    sender: owner_id, // or 'SYSTEM'
                    receiver: rejectedReq.buyer_id,
                    event_type: "PROPERTY_SOLD",
                    notification_title: "Property Sold",
                    notification_body: "A property you were interested in has been sold.",
                    metadata: { property_id }
                });
            }
        }
        
        await query('COMMIT');
        res.status(200).json({ message: "Property successfully marked as sold. All pending requests have been rejected." });

    } catch (error) {
        await query('ROLLBACK');
        console.error("Error in markPropertyAsSold transaction:", error);
        res.status(500).json({ message: "Internal server error." });
    }
};


module.exports = {
    sendPurchaseRequest: [rateLimiter, sendPurchaseRequest], // Apply rate limiter
    getMyRequests,
    getRequestsForMyProperties,
    updateRequestStatus,
    cancelRequest,
    markPropertyAsSold,
};
