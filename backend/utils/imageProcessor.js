// utils/imageProcessor.js - Image processing utilities

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Configuration
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads/profiles';
const CDN_BASE_URL = process.env.CDN_BASE_URL || 'http://localhost:5000/uploads';

// Image processing settings
const PROFILE_IMAGE_SIZES = {
  thumbnail: { width: 150, height: 150 },
  medium: { width: 300, height: 300 },
  large: { width: 600, height: 600 }
};

// Ensure upload directory exists
const ensureUploadDir = async () => {
  try {
    await fs.access(UPLOAD_DIR);
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
  }
};

// Generate unique filename
const generateUniqueFilename = (userId, originalExt = '.jpg') => {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `${userId}_${timestamp}_${random}${originalExt}`;
};

// Process and save profile image
const processProfileImage = async (file, userId) => {
  try {
    await ensureUploadDir();

    const filename = generateUniqueFilename(userId, '.webp');
    const filePath = path.join(UPLOAD_DIR, filename);

    // Process image with Sharp
    await sharp(file.buffer)
      .resize(PROFILE_IMAGE_SIZES.large.width, PROFILE_IMAGE_SIZES.large.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: 85 })
      .toFile(filePath);

    // Generate thumbnails
    await generateThumbnails(file.buffer, userId, filename);

    // Return the public URL
    return `${CDN_BASE_URL}/profiles/${filename}`;
  } catch (error) {
    console.error('Image processing error:', error);
    throw new Error('Failed to process image');
  }
};

// Generate multiple sizes of the image
const generateThumbnails = async (buffer, userId, originalFilename) => {
  const baseName = path.parse(originalFilename).name;
  
  for (const [sizeName, dimensions] of Object.entries(PROFILE_IMAGE_SIZES)) {
    if (sizeName === 'large') continue; // Skip large as it's already processed
    
    const thumbnailFilename = `${baseName}_${sizeName}.webp`;
    const thumbnailPath = path.join(UPLOAD_DIR, thumbnailFilename);
    
    await sharp(buffer)
      .resize(dimensions.width, dimensions.height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ quality: 80 })
      .toFile(thumbnailPath);
  }
};

// Delete profile image and all its variants
const deleteProfileImage = async (imageUrl) => {
  try {
    if (!imageUrl) return;

    // Extract filename from URL
    const urlParts = imageUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    const baseName = path.parse(filename).name;

    // Delete main image
    const mainImagePath = path.join(UPLOAD_DIR, filename);
    try {
      await fs.unlink(mainImagePath);
    } catch (error) {
      console.log(`Could not delete main image: ${mainImagePath}`);
    }

    // Delete thumbnails
    for (const sizeName of Object.keys(PROFILE_IMAGE_SIZES)) {
      if (sizeName === 'large') continue;
      
      const thumbnailFilename = `${baseName}_${sizeName}.webp`;
      const thumbnailPath = path.join(UPLOAD_DIR, thumbnailFilename);
      
      try {
        await fs.unlink(thumbnailPath);
      } catch (error) {
        console.log(`Could not delete thumbnail: ${thumbnailPath}`);
      }
    }
  } catch (error) {
    console.error('Delete image error:', error);
    throw new Error('Failed to delete image');
  }
};

// Validate image file
const validateImage = async (buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();
    
    // Check dimensions
    if (metadata.width < 100 || metadata.height < 100) {
      throw new Error('Image too small. Minimum size is 100x100 pixels.');
    }
    
    if (metadata.width > 5000 || metadata.height > 5000) {
      throw new Error('Image too large. Maximum size is 5000x5000 pixels.');
    }
    
    // Check format
    const allowedFormats = ['jpeg', 'jpg', 'png', 'webp'];
    if (!allowedFormats.includes(metadata.format)) {
      throw new Error('Invalid image format. Only JPEG, PNG, and WebP are allowed.');
    }
    
    return {
      isValid: true,
      metadata
    };
  } catch (error) {
    return {
      isValid: false,
      error: error.message
    };
  }
};

// Get image URLs for all sizes
const getImageUrls = (baseUrl) => {
  if (!baseUrl) return null;
  
  const urlParts = baseUrl.split('/');
  const filename = urlParts[urlParts.length - 1];
  const baseName = path.parse(filename).name;
  const baseUrlPath = urlParts.slice(0, -1).join('/');
  
  return {
    large: baseUrl,
    medium: `${baseUrlPath}/${baseName}_medium.webp`,
    thumbnail: `${baseUrlPath}/${baseName}_thumbnail.webp`
  };
};

// Optimize existing image (for migration or re-processing)
const optimizeExistingImage = async (imagePath) => {
  try {
    const buffer = await fs.readFile(imagePath);
    const optimizedBuffer = await sharp(buffer)
      .webp({ quality: 85 })
      .toBuffer();
    
    await fs.writeFile(imagePath, optimizedBuffer);
    return true;
  } catch (error) {
    console.error('Image optimization error:', error);
    return false;
  }
};

// Clean up orphaned images (utility function)
const cleanupOrphanedImages = async (activeImageUrls = []) => {
  try {
    const files = await fs.readdir(UPLOAD_DIR);
    const activeFilenames = activeImageUrls.map(url => {
      const urlParts = url.split('/');
      return urlParts[urlParts.length - 1];
    });
    
    let deletedCount = 0;
    
    for (const file of files) {
      if (!activeFilenames.includes(file)) {
        await fs.unlink(path.join(UPLOAD_DIR, file));
        deletedCount++;
      }
    }
    
    return deletedCount;
  } catch (error) {
    console.error('Cleanup error:', error);
    return 0;
  }
};

module.exports = {
  processProfileImage,
  deleteProfileImage,
  validateImage,
  getImageUrls,
  optimizeExistingImage,
  cleanupOrphanedImages,
  generateThumbnails,
  PROFILE_IMAGE_SIZES,
};
