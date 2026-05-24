const connection = require("../DB");

const pulse = (req, res) => {
  console.log("Internal pulse received.");
  res.status(200).json({ msg: "Pulse received" });
};

const getAiPropertiesSync = (req, res) => {
  const query = `
    SELECT
      property_id, owner_id,
      property_name, property_desc,
      location, latitude, longitude,
      pricing_unit, price_value, price_per_day,
      size, bedrooms_no, beds_no, bathrooms_no,
      images, is_furnished, property_type,listing_status
    FROM property
  `;
  
  connection.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching properties for AI sync:", err);
      return res.status(500).json({ error: "Database error during sync" });
    }
    
    res.status(200).json(results);
  });
};



module.exports = {
  pulse,
  getAiPropertiesSync,
};