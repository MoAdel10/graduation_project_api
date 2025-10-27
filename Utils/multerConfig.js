const multer = require("multer");
const fs = require("fs");
const path = require("path");

// Define storage engine
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let folder = "uploads/property";
    if (file.fieldname === "ownershipProof") folder = "uploads/proof";

    const dest = path.join(__dirname, "..", folder);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// Accept only image files
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (allowedTypes.includes(file.mimetype)) cb(null, true);
  else cb(new Error("❌ Only image files are allowed (jpeg, jpg, png, webp)!"), false);
};

// Initialize multer
const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // Max 5 MB per file
});

// Multer global error handler
function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    // Multer-specific error
    return res.status(400).json({ msg: `Multer error: ${err.message}` });
  } else if (err) {
    // General error (like invalid file type)
    if (req.files) {
      Object.values(req.files).flat().forEach((file) => {
        fs.unlink(file.path, (unlinkErr) => {
          if (unlinkErr) console.error("Error deleting invalid file:", unlinkErr);
        });
      });
    }
    return res.status(400).json({ msg: err.message });
  }
  next();
}

module.exports = { upload, multerErrorHandler };
