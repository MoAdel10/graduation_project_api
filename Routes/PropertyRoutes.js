const express = require("express");
const fs = require("fs");
const router = express.Router();

const verifyToken = require("../Middleware/verifyToken");
const { upload, multerErrorHandler } = require("../Utils/multerConfig");
const { addProperty,getProperties ,getPropertyById,editPropertyInfo,editPropertyImages , deleteProperty ,checkVerification } = require("../Controllers/PropertyController");


router.post(
  "/property",
  verifyToken,
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "ownershipProof", maxCount: 5 },
  ]),
  async (req, res, next) => {
    try {
      const propertyImages = req.files?.images || [];
      const proofImages = req.files?.ownershipProof || [];

      // If both image sets not provided, delete uploaded files and reject
      if (propertyImages.length === 0 || proofImages.length === 0) {
        const allUploaded = [...propertyImages, ...proofImages];
        for (const file of allUploaded) {
          fs.unlink(file.path, (err) => {
            if (err) console.error("Error deleting file:", err);
          });
        }

        return res
          .status(400)
          .json({ msg: "Both property images and ownership proof are required." });
      }

      // If all good, move to controller
      next();
    } catch (error) {
      console.error("Upload validation error:", error);
      return res.status(500).json({ msg: "Internal server error during upload validation." });
    }
  },
  multerErrorHandler, // Handle multer-specific errors
  addProperty // Continue to controller logic
);

router.get("/property", getProperties);
router.get("/property/:id", getPropertyById);
router.put("/property/:id", verifyToken, editPropertyInfo);
router.put(
  "/property/:id/images",
  verifyToken,
  upload.fields([
    { name: "images", maxCount: 10 },
    { name: "ownershipProof", maxCount: 5 },
  ]),
  multerErrorHandler,
  editPropertyImages
);
router.delete("/property/:id", verifyToken, deleteProperty);
module.exports = router;
