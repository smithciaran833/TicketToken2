// middleware/uploadMiddleware.js - File upload handling for profile images

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Define allowed file types
const ALLOWED_FILE_TYPES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

// Maximum file size (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Configure storage (memory storage for processing)
const storage = multer.memoryStorage();

// File filter function
const fileFilter = (req, file, cb) => {
  // Check if file type is allowed
  if (ALLOWED_FILE_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'), false);
  }
};

// Generate unique filename
const generateFilename = (originalName) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(6).toString('hex');
  const extension = path.extname(originalName).toLowerCase();
  return `profile_${timestamp}_${randomString}${extension}`;
};

// Configure multer
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
  fileFilter: fileFilter,
  onError: function(err, next) {
    console.error('Multer error:', err);
    next(err);
  }
});

// Error handling middleware for multer
const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large',
        errors: { image: 'Image must be smaller than 5MB' }
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files',
        errors: { image: 'Only one image allowed' }
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field',
        errors: { image: 'Unexpected file field' }
      });
    }
  }
  
  if (error.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid file type',
      errors: { image: 'Only JPEG, PNG, and WebP images are allowed' }
    });
  }

  next(error);
};

// Advanced upload middleware with additional validation
const uploadWithValidation = (fieldName) => {
  return [
    upload.single(fieldName),
    handleUploadError,
    (req, res, next) => {
      if (req.file) {
        // Add additional metadata
        req.file.generatedName = generateFilename(req.file.originalname);
        req.file.uploadedAt = new Date();
        
        // Validate image dimensions if needed
        // This will be handled in the image processor
      }
      next();
    }
  ];
};

// Multiple file upload (for future features like event images)
const uploadMultiple = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 5, // Maximum 5 files
  },
  fileFilter: fileFilter,
});

module.exports = {
  upload,
  uploadWithValidation,
  uploadMultiple,
  handleUploadError,
  generateFilename,
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE,
};
