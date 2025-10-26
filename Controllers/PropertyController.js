const connection = require("../DB");
const validateNumber = require("../Utils/validateNumber");
require("dotenv").config();

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
    req.files["images"]?.map((file) => file.filename) || [];
  const proofImages =
    req.files["ownershipProof"]?.map((file) => file.filename) || [];

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



module.exports = { addProperty };
