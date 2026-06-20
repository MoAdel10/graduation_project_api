const db = require('../DB');

const markPropertyAsSold = async (req, res) => {
    const { property_id } = req.params;
    const owner_id = req.user.userId;

    let conn;
    try {
        conn = await db.promise().getConnection();
        const txnQuery = conn.query.bind(conn);

        await txnQuery('START TRANSACTION');

        const [propertyResults] = await txnQuery("SELECT listing_status, property_type FROM property WHERE property_id = ? AND owner_id = ? FOR UPDATE", [property_id, owner_id]);

        if (propertyResults.length === 0) {
            await txnQuery('ROLLBACK');
            return res.status(404).json({ message: "Property not found or you are not the owner." });
        }

        const property = propertyResults[0];
        if (property.listing_status === 'sold') {
            await txnQuery('ROLLBACK');
            return res.status(409).json({ message: "This property is already marked as sold." });
        }

        if (property.property_type !== 'for_sale') {
            await txnQuery('ROLLBACK');
            return res.status(400).json({ message: `This property is a "${property.property_type}" listing, not "for_sale".` });
        }

        await txnQuery("UPDATE property SET listing_status = 'sold' WHERE property_id = ? AND owner_id = ?", [property_id, owner_id]);

        await txnQuery('COMMIT');
        res.status(200).json({ message: "Property successfully marked as sold." });

    } catch (error) {
        if (conn) {
            const rollbackQuery = conn.query.bind(conn);
            await rollbackQuery('ROLLBACK');
        }
        console.error("Error in markPropertyAsSold transaction:", error);
        res.status(500).json({ message: "Internal server error." });
    } finally {
        if (conn) conn.release();
    }
};

module.exports = {
    markPropertyAsSold,
};
