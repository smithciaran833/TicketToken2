// services/storageService.js - Cloud storage integration for content files

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');

// Configuration - in production, integrate with AWS S3 or similar
const LOCAL_STORAGE_PATH = process.env.CONTENT_STORAGE_PATH || './uploads/content';
const CONTENT_BASE_URL = process.env.CONTENT_BASE_URL || 'http://localhost:5000/uploads/content';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 100 * 1024 * 1024; // 100MB default

class StorageService {
  /**
   * Initialize storage service
   * Ensure directories exist
   */
  static async init() {
    try {
      await fs.mkdir(LOCAL_STORAGE_PATH, { recursive: true });
      console.log(`Storage service initialized. Path: ${LOCAL_STORAGE_PATH}`);
      return true;
    } catch (error) {
      console.error('Storage service initialization error:', error);
      return false;
    }
  }

  /**
   * Upload content file to storage
   * @param {Buffer} fileBuffer - File data buffer
   * @param {Object} metadata - File metadata
   * @returns {Promise<Object>} Upload result with URLs
   */
  static async uploadContent(fileBuffer, metadata) {
    try {
      if (!fileBuffer) {
        throw new Error('File buffer is required');
      }

      // Validate file size
      if (fileBuffer.length > MAX_FILE_SIZE) {
        throw new Error(`File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024)}MB)`);
      }

      const { 
        contentType, 
        userId, 
        eventId,
        contentId = uuidv4(),
        fileExtension = this.getFileExtension(metadata.mimeType),
        accessLevel = 'standard'
      } = metadata;

      // Create directory paths based on content type and artist
      const contentTypePath = path.join(LOCAL_STORAGE_PATH, contentType || 'misc');
      const artistPath = path.join(contentTypePath, userId);
      const eventPath = eventId ? path.join(artistPath, eventId) : artistPath;
      
      // Ensure directories exist
      await fs.mkdir(eventPath, { recursive: true });
      
      // Generate a unique filename
      const timestamp = Date.now();
      const randomString = crypto.randomBytes(4).toString('hex');
      const filename = `${contentId}_${timestamp}_${randomString}${fileExtension}`;
      const filePath = path.join(eventPath, filename);
      
      // Save the file
      await fs.writeFile(filePath, fileBuffer);
      
      // Generate URLs
      const relativePath = path.join(contentType || 'misc', userId, eventId || '', filename);
      const contentUrl = `${CONTENT_BASE_URL}/${relativePath.replace(/\\/g, '/')}`;
      
      // Generate thumbnail for images
      let thumbnailUrl = null;
      if (contentType === 'image' && fileExtension.match(/\.(jpg|jpeg|png|webp)$/i)) {
        thumbnailUrl = await this.createThumbnail(fileBuffer, eventPath, contentId);
      }
      
      return {
        contentId,
        contentUrl,
        thumbnailUrl,
        fileSize: fileBuffer.length,
        filePath,
        mimeType: metadata.mimeType,
        uploadedAt: new Date(),
        accessLevel
      };
    } catch (error) {
      console.error('Content upload error:', error);
      throw new Error(`Failed to upload content: ${error.message}`);
    }
  }
  
  /**
   * Create thumbnail for image content
   * @param {Buffer} imageBuffer - Image data
   * @param {string} dirPath - Directory path
   * @param {string} contentId - Content ID
   * @returns {Promise<string>} Thumbnail URL
   */
  static async createThumbnail(imageBuffer, dirPath, contentId) {
    try {
      const timestamp = Date.now();
      const thumbnailName = `${contentId}_${timestamp}_thumb.webp`;
      const thumbnailPath = path.join(dirPath, thumbnailName);
      
      // Create thumbnail with sharp
      await sharp(imageBuffer)
        .resize(300, 300, {
          fit: 'cover',
          position: 'center'
        })
        .webp({ quality: 80 })
        .toFile(thumbnailPath);
      
      // Generate URL
      const relativeDir = path.relative(LOCAL_STORAGE_PATH, dirPath).replace(/\\/g, '/');
      return `${CONTENT_BASE_URL}/${relativeDir}/${thumbnailName}`;
    } catch (error) {
      console.error('Thumbnail creation error:', error);
      return null;
    }
  }
  
  /**
   * Delete content from storage
   * @param {Object} content - Content object with contentUrl
   * @returns {Promise<boolean>} Deletion result
   */
  static async deleteContent(content) {
    try {
      if (!content || !content.contentUrl) {
        throw new Error('Invalid content');
      }
      
      // Extract file path from URL
      const relativePath = content.contentUrl.replace(CONTENT_BASE_URL, '').replace(/^\//, '');
      const filePath = path.join(LOCAL_STORAGE_PATH, relativePath);
      
      // Delete the file
      await fs.unlink(filePath);
      
      // Delete thumbnail if exists
      if (content.thumbnailUrl) {
        const thumbnailRelativePath = content.thumbnailUrl.replace(CONTENT_BASE_URL, '').replace(/^\//, '');
        const thumbnailPath = path.join(LOCAL_STORAGE_PATH, thumbnailRelativePath);
        
        // Ignore errors if thumbnail doesn't exist
        try {
          await fs.unlink(thumbnailPath);
        } catch (error) {
          console.log('Thumbnail not found or already deleted:', thumbnailPath);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Content deletion error:', error);
      return false;
    }
  }
  
  /**
   * Generate signed URL for content access
   * @param {Object} content - Content object
   * @param {Object} user - User requesting access
   * @param {string} ticket - Ticket ID used for access
   * @returns {string} Signed URL
   */
  static generateSignedUrl(content, user, ticket) {
    // Expiration time (1 hour)
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    
    // Create signature payload
    const payload = {
      contentId: content.contentId,
      userId: user._id.toString(),
      ticketId: ticket,
      expiresAt
    };
    
    // Generate signature
    const signature = crypto
      .createHmac('sha256', process.env.JWT_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    // Add signature and expiry to URL
    const baseUrl = content.contentUrl;
    const separator = baseUrl.includes('?') ? '&' : '?';
    
    return `${baseUrl}${separator}sig=${signature}&exp=${expiresAt}&uid=${user._id}&tid=${ticket}`;
  }
  
  /**
   * Verify signed URL
   * @param {Object} params - URL parameters
   * @returns {boolean} Verification result
   */
  static verifySignedUrl(params) {
    try {
      const { sig, exp, uid, tid, contentId } = params;
      
      // Check if URL has expired
      const now = Math.floor(Date.now() / 1000);
      if (now > parseInt(exp, 10)) {
        return false;
      }
      
      // Recreate signature payload
      const payload = {
        contentId,
        userId: uid,
        ticketId: tid,
        expiresAt: parseInt(exp, 10)
      };
      
      // Generate expected signature
      const expectedSignature = crypto
        .createHmac('sha256', process.env.JWT_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');
      
      // Verify signature
      return sig === expectedSignature;
    } catch (error) {
      console.error('URL verification error:', error);
      return false;
    }
  }
  
  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} File extension
   */
  static getFileExtension(mimeType) {
    const extensions = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'application/pdf': '.pdf',
      'application/json': '.json',
      'text/plain': '.txt',
      'text/html': '.html'
    };
    
    return extensions[mimeType] || '.bin';
  }
  
  /**
   * Get file MIME type from extension
   * @param {string} filename - Filename with extension
   * @returns {string} MIME type
   */
  static getMimeType(filename) {
    const extension = path.extname(filename).toLowerCase();
    
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.pdf': 'application/pdf',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.html': 'text/html'
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
  }
  
  /**
   * Clean up orphaned content files
   * @returns {Promise<number>} Number of files deleted
   */
  static async cleanupOrphanedFiles() {
    try {
      // This would typically be implemented with a database query
      // to find files in storage that don't have a corresponding record
      console.log('File cleanup would run here in production');
      return 0;
    } catch (error) {
      console.error('File cleanup error:', error);
      return 0;
    }
  }
}

module.exports = StorageService;
