const connection = require("../DB");
const validateNumber = require("../Utils/validateNumber");
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const triggerReverification = require("../Utils/triggerReverification");

const addProperty = (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ msg: "all fields are required" });
  }

const {
  propertyName,
  propertyDesc,
  location,

  // old
  pricePerDay,

  // new
  pricingUnit,
  priceValue,

  size,
  bedroomsNumber,
  bedsNumber,
  bathroomsNumber,
  is_furnished,
  property_type,
  latitude,
  longitude,
  
} = req.body;


if (
  !propertyName ||
  !propertyDesc ||
  !location ||
  !size ||
  !bedroomsNumber ||
  !bedsNumber ||
  !bathroomsNumber
) {
  return res.status(400).json({ msg: "all fields are required" });
}

  // Pricing validation
  const unit = (pricingUnit || "DAY").toUpperCase();
  const allowedUnits = ["DAY", "MONTH", "YEAR"];
  if (!allowedUnits.includes(unit)) {
    return res.status(400).json({ msg: "pricingUnit must be DAY, MONTH, or YEAR" });
  }

  // Decide the owner-facing price value
  const rawValue = priceValue ?? pricePerDay;
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return res.status(400).json({ msg: "priceValue (or pricePerDay) is required" });
  }

  const value = validateNumber(rawValue);
  if (!value || value <= 0) {
    return res.status(400).json({ msg: "price must be a valid number > 0" });
  }

  // Normalize to daily pricing (policy: month=30 days, year=365 days)
  let pricePerDayNormalized = value;
  if (unit === "MONTH") pricePerDayNormalized = value / 30;
  if (unit === "YEAR") pricePerDayNormalized = value / 365;

  // Keep 2 decimals
  pricePerDayNormalized = Number(pricePerDayNormalized.toFixed(2));


  const propertyImages =
    req.files["images"]?.map((file) => `uploads/property/${file.filename}`) ||
    [];
  const proofImages =
    req.files["ownershipProof"]?.map(
      (file) => `uploads/proof/${file.filename}`,
    ) || [];

  if (!propertyImages || !proofImages) {
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

    pricing_unit,
    price_value,
    price_per_day,

    size,
    bedrooms_no,
    beds_no,
    bathrooms_no,
    images,
    ownership_proofs,
    is_furnished,
    property_type,
    latitude,
    longitude
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?)
`;


const values = [
  req.user.userId,
  propertyName,
  propertyDesc,
  location,

  unit,
  value,
  pricePerDayNormalized,

  size,
  validateNumber(bedroomsNumber),
  validateNumber(bedsNumber),
  validateNumber(bathroomsNumber),
  JSON.stringify(propertyImages),
  JSON.stringify(proofImages),
  is_furnished==true?1:0,
  property_type,
  latitude,
  longitude
];


  connection.query(sql, values, (err, result) => {
    if (err) {
      console.error("❌ Error inserting property:", err);
      return res.status(500).json({ msg: "Database error" });
    }

    triggerReverification(connection, result.insertId, req.user.userId, (err) => {
      if (err)
        return res
          .status(500)
          .json({ msg: "Failed to trigger re-verification" });

      res.status(201).json({
        msg: "Property added successfully",
        propertyId: result.insertId,
      });
    });
  });
};

const getProperties = (req, res) => {
  let { location, minPrice, maxPrice, minSize, maxSize, bedrooms, bathrooms,longitude,latitude } =
    req.query;
  // http://localhost:8000/property?minPrice=20 methal 3shan barghout maysara54  (ma fuck barghout ya 3am (sarhan))

  // Base SQL query
  let sql = "SELECT * FROM Property WHERE 1=1";
  const params = [];

  // Add filters dynamically
  if (location) {
    sql += " AND location LIKE ?";
    params.push(`%${location}%`);
  }
  if (longitude) {
    sql += " AND longitude = ?";
    params.push(`%${longitude}%`);
  }
  if (latitude) {
    sql += " AND latitude = ?";
    params.push(`%${latitude}%`);
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
      // FIX: The mysql2 driver returns arrays directly for JSON fields.
      images: prop.images || [],
      ownership_proofs: prop.ownership_proofs || [],
    }));

    res.status(200).json(properties);
  });
};

const getPropertyById = (req, res) => {
  const { id } = req.params;
  //http://localhost:8000/property/9 [ bardo 3shan barghout ma yesar54] (ma fuck barghout ya 3am (sarhan))
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

    // FIX: Remove JSON.parse. The mysql2 driver handles parsing the JSON column.
    property.images = property.images || [];
    property.ownership_proofs = property.ownership_proofs || [];

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
    latitude,
    longitude,
  } = req.body;

  // Verify ownership
  connection.query(
    "SELECT * FROM Property WHERE property_id = ?",
    [id],
    (err, results) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      if (results.length === 0)
        return res.status(404).json({ msg: "Property not found" });

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
          bathrooms_no = ?,
          latitude = ?,
          longitude = ?,
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
        latitude || property.latitude,
        longitude || property.longitude,
        id,
      ];

      connection.query(sql, values, (err) => {
        if (err) return res.status(500).json({ msg: "Database error" });
        triggerReverification(connection, id, userId, (err) => {
          if (err)
            return res
              .status(500)
              .json({ msg: "Failed to trigger re-verification" });

          res.status(200).json({
            msg: "✅ Info updated. Property is now pending re-verification.",
          });
        });
      });
    },
  );
};

const editPropertyImages = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const newPropertyImages =
    req.files["images"]?.map((f) => `uploads/property/${f.filename}`) || [];
  const newProofImages =
    req.files["ownershipProof"]?.map((f) => `uploads/proof/${f.filename}`) ||
    [];

  // Require at least one set of images
  if (newPropertyImages.length === 0 && newProofImages.length === 0) {
    return res.status(400).json({
      msg: "❌ You must upload at least property images or proof images",
    });
  }

  // Fetch the property to verify ownership
  connection.query(
    "SELECT * FROM Property WHERE property_id = ?",
    [id],
    (err, results) => {
      if (err) return res.status(500).json({ msg: "Database error" });
      if (results.length === 0)
        return res.status(404).json({ msg: "Property not found" });

      const property = results[0];
      if (property.owner_id !== userId)
        return res.status(403).json({ msg: "Unauthorized" });

      let oldImages = [];
      let oldProofs = [];

      // FIX: Remove JSON.parse from the try block. The driver returns arrays.
      try {
        oldImages = property.images || [];
        oldProofs = property.ownership_proofs || [];
      } catch (err) {
        console.error("⚠️ Failed to handle images/proofs:", err);
      }

      // Replace old property images if new ones provided
      let updatedImages = oldImages;
      if (newPropertyImages.length > 0) {
        oldImages.forEach((file) => {
          fs.unlink(path.join(__dirname, "..", file), (err) => {
            if (err)
              console.warn("⚠️ Could not delete old property image:", file);
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
      // JSON.stringify is still necessary here to convert the JS array back to a JSON string for the DB.
      const values = [
        JSON.stringify(updatedImages),
        JSON.stringify(updatedProofs),
        id,
      ];

      connection.query(sql, values, (err) => {
        if (err) return res.status(500).json({ msg: "Database error" });

        triggerReverification(connection, id, userId, (err) => {
          if (err)
            return res
              .status(500)
              .json({ msg: "Failed to trigger re-verification" });

          res.status(200).json({
            msg: "✅ Property images updated successfully",
            images: updatedImages,
            ownershipProofs: updatedProofs,
          });
        });
      });
    },
  );
};
// =======================Delete Properity=========================
const deleteProperty = (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId; // Owner's ID from token

  // Fetch the property first to verify ownership
  connection.query(
    "SELECT * FROM Property WHERE property_id = ?",
    [id],
    (err, results) => {
      if (err) return res.status(500).json({ msg: "Database error" }); // 500 for DB or unexpected errors
      if (results.length === 0)
        return res.status(404).json({ msg: "Property not found" }); // 404 if property doesn’t exist

      const property = results[0];

      // Verify ownership
      if (property.owner_id !== userId) {
        return res
          .status(403)
          .json({ msg: "Unauthorized to delete this property" }); // 403 if user is not owner
      }

      // Delete property images and proofs from the filesystem
      try {
        // FIX: Remove JSON.parse. The driver returns arrays.
        const images = property.images || [];
        const proofs = property.ownership_proofs || [];

        [...images, ...proofs].forEach((filePath) => {
          fs.unlink(path.join(__dirname, "..", filePath), (err) => {
            if (err) console.warn("⚠️ Could not delete file:", filePath);
          });
        });
      } catch (err) {
        console.error("⚠️ Error processing file paths for deletion:", err);
      }

      // Delete the property from the database
      connection.query(
        "DELETE FROM Property WHERE property_id = ?",
        [id],
        (err) => {
          if (err) return res.status(500).json({ msg: "Database error" });
          res.status(200).json({ msg: "✅ Property deleted successfully" }); // 200 if deletion succeeds
        },
      );
    },
  );
};


const getMyProperty = (req, res) => {
  const userId = req.user.userId;

  const sql = `
    SELECT 
      property_id, 
      property_name, 
      location,
      longitude,
      latitude,
      pricing_unit, 
      price_value, 
      price_per_day, 
      is_available, 
      is_verified, 
      images,
      rate
    FROM Property 
    WHERE owner_id = ?
    ORDER BY property_id DESC
  `;

  connection.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("❌ DB Error in getMyProperty:", err);
      return res.status(500).json({ msg: "Database error occurred" });
    }

    const formattedResults = results.map(prop => ({
      ...prop,
    
      images: typeof prop.images === 'string' ? JSON.parse(prop.images) : prop.images,
      is_available: !!prop.is_available,
      is_verified: !!prop.is_verified
    }));

    res.status(200).json(formattedResults);
  });
};
module.exports = {
  addProperty,
  getProperties,
  getPropertyById,
  editPropertyInfo,
  editPropertyImages,
  deleteProperty,
  getMyProperty
};
