const connection = require("../DB");
const validateNumber = require("../Utils/validateNumber");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const addProperty = (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ msg: "all fields are required" });
  }

  const {
    propertyName,
    propertyDesc,
    location,
    pricePerDay,
    size,
    bedroomsNumber,
    bedsNumber,
    bathroomsNumber,
  } = req.body;

  if (
    !propertyName ||
    !propertyDesc ||
    !location ||
    !pricePerDay ||
    !size ||
    !bedroomsNumber ||
    !bedsNumber ||
    !bathroomsNumber
  ) {
    return res.status(400).json({ msg: "all fields are required" });
  }

  const propertyImages =
    req.files["images"]?.map((file) => `uploads/property/${file.filename}`) || [];
  const proofImages =
    req.files["ownershipProof"]?.map((file) => `uploads/property/${file.filename}`) || [];

    if (!propertyImages|| !proofImages) {
    return res
      .status(400)
      .json({ msg: "Please upload property and ownership images" });
  }

  if (propertyImages.length === 0 || proofImages.length === 0) {
    return res
      .status(400)
      .json({ msg: "Please upload property and ownership images" });
  }

  const sql = `
    INSERT INTO Property (
      owner_id,
      property_name,
      property_desc,
      location,
      price_per_day,
      size,
      bedrooms_no,
      beds_no,
      bathrooms_no,
      images,
      ownership_proofs
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    req.user.userId,
    propertyName,
    propertyDesc,
    location,
    validateNumber(pricePerDay),
    size,
    validateNumber(bedroomsNumber),
    validateNumber(bedsNumber),
    validateNumber(bathroomsNumber),
    JSON.stringify(propertyImages),
    JSON.stringify(proofImages),
  ];



  connection.query(sql, values, (err, result) => {
    if (err) {
      console.error("❌ Error inserting property:", err);
      return res.status(500).json({ msg: "Database error" });
    }

    res.status(201).json({
      msg: "Property added successfully",
      propertyId: result.insertId,
    });
  });
};

const getProperties = (req, res) => {
  let { location, minPrice, maxPrice, minSize, maxSize, bedrooms, bathrooms } = req.query; 
  // http://localhost:8000/property?minPrice=20 methal 3shan barghout maysara54  (ma fuck barghout ya 3am (sarhan))

  // Base SQL query
  let sql = "SELECT * FROM Property WHERE 1=1";
  const params = [];

  // Add filters dynamically
  if (location) {
    sql += " AND location LIKE ?";
    params.push(`%${location}%`);
  }
  if (minPrice) {
    sql += " AND price_per_day >= ?";
    params.push(validateNumber(minPrice));
  }
  if (maxPrice) {
    sql += " AND price_per_day <= ?";
    params.push(validateNumber(maxPrice));
  }
  if (minSize) {
    sql += " AND size >= ?";
    params.push(validateNumber(minSize));
  }
  if (maxSize) {
    sql += " AND size <= ?";
    params.push(validateNumber(maxSize));
  }
  if (bedrooms) {
    sql += " AND bedrooms_no = ?";
    params.push(validateNumber(bedrooms));
  }
  if (bathrooms) {
    sql += " AND bathrooms_no = ?";
    params.push(validateNumber(bathrooms));
  }

  connection.query(sql, params, (err, results) => {
    if (err) {
      console.error("❌ Error fetching properties:", err);
      return res.status(500).json({ msg: "Database error" });
    }

  
    const properties = results.map((prop) => ({
      ...prop,
      images: JSON.parse(prop.images || "[]"),
      ownership_proofs: JSON.parse(prop.ownership_proofs || "[]"),
    }));

    res.status(200).json(properties);
  });
};

const getPropertyById = (req, res) => {
  const { id } = req.params;
  //http://localhost:8000/property/9 [ bardo 3shan barghout ma yesar54] (ma fuck barghout ya 3am (sarhan))[ya 3am e7na eli hanet3ab wallahi(3adel)]
  const sql = `
    SELECT 
      p.*, 
      u.first_name AS owner_first_name,
      u.second_name AS owner_second_name,
      u.email AS owner_email
    FROM Property p
    LEFT JOIN Users u ON p.owner_id = u.user_id
    WHERE p.property_id = ?
  `;

  connection.query(sql, [id], (err, results) => {
    if (err) {
      console.error("❌ Error fetching property by ID:", err);
      return res.status(500).json({ msg: "Database error" });
    }

    if (results.length === 0) {
      return res.status(404).json({ msg: "Property not found" });
    }

    const property = results[0];

    // Parse JSON fields
    property.images = JSON.parse(property.images || "[]");
    property.ownership_proofs = JSON.parse(property.ownership_proofs || "[]");

    res.status(200).json(property);
  });
};

const editPropertyInfo = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const {
    propertyName,
    propertyDesc,
    location,
    pricePerDay,
    size,
    bedroomsNumber,
    bedsNumber,
    bathroomsNumber,
  } = req.body;

  // Verify ownership
  connection.query(
    "SELECT * FROM Property WHERE property_id = ?",
    [id],
    (err, results) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      if (results.length === 0) return res.status(404).json({ msg: "Property not found" });

      const property = results[0];
      if (property.owner_id !== userId)
        return res.status(403).json({ msg: "Unauthorized" });

      const sql = `
        UPDATE Property SET
          property_name = ?,
          property_desc = ?,
          location = ?,
          price_per_day = ?,
          size = ?,
          bedrooms_no = ?,
          beds_no = ?,
          bathrooms_no = ?
        WHERE property_id = ?
      `;

      const values = [
        propertyName || property.property_name,
        propertyDesc || property.property_desc,
        location || property.location,
        pricePerDay || property.price_per_day,
        size || property.size,
        bedroomsNumber || property.bedrooms_no,
        bedsNumber || property.beds_no,
        bathroomsNumber || property.bathrooms_no,
        id,
      ];

      connection.query(sql, values, (err) => {
        if (err) return res.status(500).json({ msg: "Database error" });
        res.status(200).json({ msg: "✅ Property info updated successfully" });
      });
    }
  );
};

const editPropertyImages = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const newPropertyImages = req.files["images"]?.map((f) => `uploads/property/${f.filename}`) || [];
  const newProofImages = req.files["ownershipProof"]?.map((f) => `uploads/proof/${f.filename}`) || [];

  // Require at least one set of images
  if (newPropertyImages.length === 0 && newProofImages.length === 0) {
    return res.status(400).json({ msg: "❌ You must upload at least property images or proof images" });
  }

  // Fetch the property to verify ownership
  connection.query("SELECT * FROM Property WHERE property_id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ msg: "Database error" });
    if (results.length === 0) return res.status(404).json({ msg: "Property not found" });

    const property = results[0];
    if (property.owner_id !== userId)
      return res.status(403).json({ msg: "Unauthorized" });

    let oldImages = [];
    let oldProofs = [];

    try {
      oldImages = property.images ? JSON.parse(property.images) : [];
      oldProofs = property.ownership_proofs ? JSON.parse(property.ownership_proofs) : [];
    } catch (err) {
      console.error("⚠️ Failed to parse JSON:", err);
    }

    // Replace old property images if new ones provided
    let updatedImages = oldImages;
    if (newPropertyImages.length > 0) {
      oldImages.forEach((file) => {
        fs.unlink(path.join(__dirname, "..", file), (err) => {
          if (err) console.warn("⚠️ Could not delete old property image:", file);
        });
      });
      updatedImages = newPropertyImages;
    }

    // Replace old proof images if new ones provided
    let updatedProofs = oldProofs;
    if (newProofImages.length > 0) {
      oldProofs.forEach((file) => {
        fs.unlink(path.join(__dirname, "..", file), (err) => {
          if (err) console.warn("⚠️ Could not delete old proof image:", file);
        });
      });
      updatedProofs = newProofImages;
    }

    // Update the database
    const sql = `
      UPDATE Property SET
        images = ?,
        ownership_proofs = ?
      WHERE property_id = ?
    `;
    const values = [JSON.stringify(updatedImages), JSON.stringify(updatedProofs), id];

    connection.query(sql, values, (err) => {
      if (err) return res.status(500).json({ msg: "Database error" });

      res.status(200).json({
        msg: "✅ Property images updated successfully",
        images: updatedImages,
        ownershipProofs: updatedProofs,
      });
    });
  });
};
// =======================Delete Properity=========================
const deleteProperty = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId; // Owner's ID from token

  // Fetch the property first to verify ownership
  connection.query("SELECT * FROM Property WHERE property_id = ?", [id], (err, results) => {
    if (err) return res.status(500).json({ msg: "Database error" }); // 500 for DB or unexpected errors
    if (results.length === 0) return res.status(404).json({ msg: "Property not found" }); // 404 if property doesn’t exist

    const property = results[0];

    // Verify ownership
    if (property.owner_id !== userId) {
      return res.status(403).json({ msg: "Unauthorized to delete this property" }); // 403 if user is not owner
    }

    // Delete property images and proofs from the filesystem
    try {
      const images = property.images ? JSON.parse(property.images) : [];
      const proofs = property.ownership_proofs ? JSON.parse(property.ownership_proofs) : [];

      [...images, ...proofs].forEach((filePath) => {
        fs.unlink(path.join(__dirname, "..", filePath), (err) => {
          if (err) console.warn("⚠️ Could not delete file:", filePath);
        });
      });
    } catch (err) {
      console.error("⚠️ Error parsing JSON for deletion:", err); 
    }

    // Delete the property from the database
    connection.query("DELETE FROM Property WHERE property_id = ?", [id], (err) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      res.status(200).json({ msg: "✅ Property deleted successfully" }); // 200 if deletion succeeds
    }); 
  });
};

module.exports = {
  addProperty,
  getProperties,
  getPropertyById,
  editPropertyInfo,
  editPropertyImages,
  deleteProperty
};
