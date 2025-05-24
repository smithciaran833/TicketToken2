const db = require('../database/connection');
const { uploadToStorage, deleteFromStorage, getSignedUrl } = require('../utils/storage');
const { validateNFTOwnership } = require('../utils/blockchain');
const { createHash } = require('crypto');
const path = require('path');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');

class ContentService {
  /**
   * Create new content entry
   * @param {Object} contentData - Content metadata
   * @param {string} artistId - Artist ID
   * @returns {Object} Created content
   */
  async createContent(contentData, artistId) {
    try {
      const {
        title,
        description,
        type,
        filePath,
        fileName,
        fileSize,
        mimeType,
        duration,
        accessTier,
        nftContractAddress,
        tokenIds,
        previewPath,
        tags
      } = contentData;

      // Generate content hash for integrity
      const contentHash = createHash('sha256')
        .update(`${title}${artistId}${Date.now()}`)
        .digest('hex');

      const contentId = uuidv4();

      const query = `
        INSERT INTO content (
          id, artist_id, title, description, type, file_path, 
          file_name, file_size, mime_type, duration, access_tier,
          nft_contract_address, token_ids, preview_path, tags,
          content_hash, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
      `;

      await db.execute(query, [
        contentId,
        artistId,
        title,
        description || null,
        type,
        filePath,
        fileName,
        fileSize || 0,
        mimeType,
        duration || null,
        accessTier || 'public',
        nftContractAddress || null,
        JSON.stringify(tokenIds || []),
        previewPath || null,
        JSON.stringify(tags || []),
        contentHash
      ]);

      // Log content creation
      await this.logContentActivity(contentId, artistId, 'created');

      return await this.getContentById(contentId);
    } catch (error) {
      console.error('Error creating content:', error);
      throw new Error('Failed to create content');
    }
  }

  /**
   * Update existing content
   * @param {string} contentId - Content ID
   * @param {Object} updates - Updates to apply
   * @param {string} userId - User ID making update
   * @returns {Object} Updated content
   */
  async updateContent(contentId, updates, userId) {
    try {
      // Verify ownership or admin access
      const content = await this.getContentById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      if (content.artist_id !== userId) {
        // Check if user is admin
        const userRole = await this.getUserRole(userId);
        if (userRole !== 'admin') {
          throw new Error('Unauthorized to update content');
        }
      }

      const allowedUpdates = [
        'title', 'description', 'access_tier', 'nft_contract_address',
        'token_ids', 'tags', 'status'
      ];

      const updateFields = [];
      const updateValues = [];

      Object.keys(updates).forEach(key => {
        if (allowedUpdates.includes(key)) {
          updateFields.push(`${key} = ?`);
          
          // Handle JSON fields
          if (['token_ids', 'tags'].includes(key)) {
            updateValues.push(JSON.stringify(updates[key]));
          } else {
            updateValues.push(updates[key]);
          }
        }
      });

      if (updateFields.length === 0) {
        throw new Error('No valid fields to update');
      }

      updateFields.push('updated_at = NOW()');
      updateValues.push(contentId);

      const query = `UPDATE content SET ${updateFields.join(', ')} WHERE id = ?`;
      await db.execute(query, updateValues);

      // Log update activity
      await this.logContentActivity(contentId, userId, 'updated', JSON.stringify(updates));

      return await this.getContentById(contentId);
    } catch (error) {
      console.error('Error updating content:', error);
      throw error;
    }
  }

  /**
   * Get content with access verification
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID requesting access
   * @returns {Object} Content data
   */
  async getContent(contentId, userId) {
    try {
      const content = await this.getContentById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Check access permissions
      const hasAccess = await this.checkAccess(contentId, userId);
      if (!hasAccess) {
        // Return limited preview data for gated content
        return {
          id: content.id,
          title: content.title,
          description: content.description,
          type: content.type,
          artist_id: content.artist_id,
          artist_name: content.artist_name,
          preview_path: content.preview_path,
          access_tier: content.access_tier,
          nft_contract_address: content.nft_contract_address,
          token_ids: content.token_ids,
          created_at: content.created_at,
          access_granted: false,
          requires_nft: content.access_tier === 'nft_gated'
        };
      }

      // Log content access
      await this.logContentActivity(contentId, userId, 'accessed');

      return {
        ...content,
        access_granted: true,
        signed_url: await getSignedUrl(content.file_path, 3600) // 1 hour expiry
      };
    } catch (error) {
      console.error('Error getting content:', error);
      throw error;
    }
  }

  /**
   * Get user's accessible content with filters
   * @param {string} userId - User ID
   * @param {Object} filters - Search and filter options
   * @returns {Array} Content list
   */
  async getUserContent(userId, filters = {}) {
    try {
      const {
        type,
        access_tier,
        artist_id,
        search,
        page = 1,
        limit = 20,
        sort = 'created_at',
        order = 'DESC'
      } = filters;

      let baseQuery = `
        SELECT c.*, a.username as artist_name, a.profile_image as artist_avatar
        FROM content c
        LEFT JOIN users a ON c.artist_id = a.id
        WHERE c.status = 'active'
      `;

      const queryParams = [];

      // Add filters
      if (type) {
        baseQuery += ' AND c.type = ?';
        queryParams.push(type);
      }

      if (access_tier) {
        baseQuery += ' AND c.access_tier = ?';
        queryParams.push(access_tier);
      }

      if (artist_id) {
        baseQuery += ' AND c.artist_id = ?';
        queryParams.push(artist_id);
      }

      if (search) {
        baseQuery += ' AND (c.title LIKE ? OR c.description LIKE ?)';
        queryParams.push(`%${search}%`, `%${search}%`);
      }

      // Add access control - only show content user can access
      baseQuery += `
        AND (
          c.access_tier = 'public' 
          OR c.artist_id = ?
          OR EXISTS (
            SELECT 1 FROM user_nft_holdings unh 
            WHERE unh.user_id = ? 
            AND unh.contract_address = c.nft_contract_address
            AND JSON_CONTAINS(c.token_ids, CAST(unh.token_id as JSON))
          )
        )
      `;
      queryParams.push(userId, userId);

      // Add sorting
      const allowedSorts = ['created_at', 'title', 'type', 'file_size'];
      const sortField = allowedSorts.includes(sort) ? sort : 'created_at';
      const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      
      baseQuery += ` ORDER BY c.${sortField} ${sortOrder}`;

      // Add pagination
      const offset = (page - 1) * limit;
      baseQuery += ' LIMIT ? OFFSET ?';
      queryParams.push(parseInt(limit), offset);

      const [rows] = await db.execute(baseQuery, queryParams);

      // Process results to include access status
      const processedContent = await Promise.all(
        rows.map(async (content) => {
          const hasAccess = await this.checkAccess(content.id, userId);
          return {
            ...content,
            token_ids: JSON.parse(content.token_ids || '[]'),
            tags: JSON.parse(content.tags || '[]'),
            access_granted: hasAccess,
            preview_url: content.preview_path ? await getSignedUrl(content.preview_path, 3600) : null
          };
        })
      );

      // Get total count for pagination
      let countQuery = baseQuery.replace(/SELECT c\.\*, a\.username as artist_name, a\.profile_image as artist_avatar/, 'SELECT COUNT(*) as total');
      countQuery = countQuery.replace(/ORDER BY.*/, '').replace(/LIMIT.*/, '');
      
      const [countResult] = await db.execute(countQuery, queryParams.slice(0, -2));
      const total = countResult[0].total;

      return {
        content: processedContent,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error getting user content:', error);
      throw error;
    }
  }

  /**
   * Delete content
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID requesting deletion
   * @returns {boolean} Success status
   */
  async deleteContent(contentId, userId) {
    try {
      const content = await this.getContentById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Verify ownership or admin access
      if (content.artist_id !== userId) {
        const userRole = await this.getUserRole(userId);
        if (userRole !== 'admin') {
          throw new Error('Unauthorized to delete content');
        }
      }

      // Soft delete - mark as deleted
      await db.execute(
        'UPDATE content SET status = ?, deleted_at = NOW() WHERE id = ?',
        ['deleted', contentId]
      );

      // Delete from storage (optional - could be done by cleanup job)
      try {
        if (content.file_path) {
          await deleteFromStorage(content.file_path);
        }
        if (content.preview_path) {
          await deleteFromStorage(content.preview_path);
        }
      } catch (storageError) {
        console.warn('Storage cleanup failed:', storageError);
      }

      // Log deletion
      await this.logContentActivity(contentId, userId, 'deleted');

      return true;
    } catch (error) {
      console.error('Error deleting content:', error);
      throw error;
    }
  }

  /**
   * Stream content with access control
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID
   * @returns {Object} Streaming URL and metadata
   */
  async streamContent(contentId, userId) {
    try {
      const hasAccess = await this.checkAccess(contentId, userId);
      if (!hasAccess) {
        throw new Error('Access denied to content');
      }

      const content = await this.getContentById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Generate streaming URL with longer expiry for streaming
      const streamingUrl = await getSignedUrl(content.file_path, 7200); // 2 hours

      // Log streaming activity
      await this.logContentActivity(contentId, userId, 'streamed');

      // Update view count
      await this.incrementViewCount(contentId);

      return {
        streaming_url: streamingUrl,
        content_type: content.mime_type,
        duration: content.duration,
        file_size: content.file_size,
        title: content.title
      };
    } catch (error) {
      console.error('Error streaming content:', error);
      throw error;
    }
  }

  /**
   * Handle content downloads
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID
   * @returns {Object} Download URL and metadata
   */
  async downloadContent(contentId, userId) {
    try {
      const hasAccess = await this.checkAccess(contentId, userId);
      if (!hasAccess) {
        throw new Error('Access denied to content');
      }

      const content = await this.getContentById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }

      // Check if downloads are allowed for this content
      if (content.allow_download === 0) {
        throw new Error('Downloads not permitted for this content');
      }

      // Generate download URL
      const downloadUrl = await getSignedUrl(content.file_path, 1800); // 30 minutes

      // Log download activity
      await this.logContentActivity(contentId, userId, 'downloaded');

      // Update download count
      await this.incrementDownloadCount(contentId);

      return {
        download_url: downloadUrl,
        file_name: content.file_name,
        file_size: content.file_size,
        mime_type: content.mime_type
      };
    } catch (error) {
      console.error('Error downloading content:', error);
      throw error;
    }
  }

  /**
   * Check user access to content based on NFT ownership
   * @param {string} contentId - Content ID
   * @param {string} userId - User ID
   * @returns {boolean} Access granted
   */
  async checkAccess(contentId, userId) {
    try {
      const content = await this.getContentById(contentId);
      if (!content) {
        return false;
      }

      // Public content - always accessible
      if (content.access_tier === 'public') {
        return true;
      }

      // Owner always has access
      if (content.artist_id === userId) {
        return true;
      }

      // Admin access
      const userRole = await this.getUserRole(userId);
      if (userRole === 'admin') {
        return true;
      }

      // NFT-gated content
      if (content.access_tier === 'nft_gated') {
        if (!content.nft_contract_address) {
          return false;
        }

        const tokenIds = JSON.parse(content.token_ids || '[]');
        
        // If no specific tokens required, check for any token from contract
        if (tokenIds.length === 0) {
          const [rows] = await db.execute(
            'SELECT COUNT(*) as count FROM user_nft_holdings WHERE user_id = ? AND contract_address = ?',
            [userId, content.nft_contract_address]
          );
          return rows[0].count > 0;
        }

        // Check for specific token ownership
        const placeholders = tokenIds.map(() => '?').join(',');
        const [rows] = await db.execute(
          `SELECT COUNT(*) as count FROM user_nft_holdings 
           WHERE user_id = ? AND contract_address = ? AND token_id IN (${placeholders})`,
          [userId, content.nft_contract_address, ...tokenIds]
        );
        
        return rows[0].count > 0;
      }

      // Premium tier - could be subscription based
      if (content.access_tier === 'premium') {
        const [rows] = await db.execute(
          'SELECT COUNT(*) as count FROM user_subscriptions WHERE user_id = ? AND status = ? AND expires_at > NOW()',
          [userId, 'active']
        );
        return rows[0].count > 0;
      }

      return false;
    } catch (error) {
      console.error('Error checking access:', error);
      return false;
    }
  }

  /**
   * Get content analytics
   * @param {string} contentId - Content ID
   * @returns {Object} Analytics data
   */
  async getContentAnalytics(contentId) {
    try {
      // Get basic metrics
      const [metricsResult] = await db.execute(
        'SELECT view_count, download_count, like_count, share_count FROM content WHERE id = ?',
        [contentId]
      );

      if (metricsResult.length === 0) {
        throw new Error('Content not found');
      }

      const metrics = metricsResult[0];

      // Get activity over time (last 30 days)
      const [activityResult] = await db.execute(`
        SELECT 
          DATE(created_at) as date,
          activity_type,
          COUNT(*) as count
        FROM content_activity 
        WHERE content_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY DATE(created_at), activity_type
        ORDER BY date DESC
      `, [contentId]);

      // Get top countries/regions
      const [regionResult] = await db.execute(`
        SELECT 
          COALESCE(metadata->>'$.country', 'Unknown') as country,
          COUNT(*) as count
        FROM content_activity 
        WHERE content_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY country
        ORDER BY count DESC
        LIMIT 10
      `, [contentId]);

      // Get user engagement
      const [engagementResult] = await db.execute(`
        SELECT 
          COUNT(DISTINCT user_id) as unique_users,
          AVG(CASE WHEN activity_type = 'accessed' THEN 1 ELSE 0 END) as avg_access_rate
        FROM content_activity 
        WHERE content_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      `, [contentId]);

      return {
        metrics,
        activity: activityResult,
        regions: regionResult,
        engagement: engagementResult[0],
        period: '30_days'
      };
    } catch (error) {
      console.error('Error getting content analytics:', error);
      throw error;
    }
  }

  /**
   * Process uploaded content file
   * @param {Object} file - Uploaded file
   * @param {Object} metadata - Content metadata
   * @returns {Object} Processed file information
   */
  async processContentUpload(file, metadata) {
    try {
      const { originalname, buffer, mimetype, size } = file;
      const { artistId, contentType } = metadata;

      // Generate unique filename
      const fileExtension = path.extname(originalname);
      const fileName = `${uuidv4()}${fileExtension}`;
      const filePath = `content/${artistId}/${fileName}`;

      // Upload original file
      const uploadResult = await uploadToStorage(buffer, filePath, mimetype);

      const processedFile = {
        file_path: filePath,
        file_name: originalname,
        file_size: size,
        mime_type: mimetype,
        storage_url: uploadResult.url
      };

      // Generate preview for different content types
      if (contentType === 'image') {
        const previewBuffer = await this.generateImagePreview(buffer);
        const previewPath = `previews/${artistId}/${fileName}_preview.jpg`;
        await uploadToStorage(previewBuffer, previewPath, 'image/jpeg');
        processedFile.preview_path = previewPath;
      } else if (contentType === 'video') {
        const thumbnailBuffer = await this.generateVideoThumbnail(buffer);
        const thumbnailPath = `previews/${artistId}/${fileName}_thumb.jpg`;
        await uploadToStorage(thumbnailBuffer, thumbnailPath, 'image/jpeg');
        processedFile.preview_path = thumbnailPath;
        
        // Get video duration
        processedFile.duration = await this.getVideoDuration(buffer);
      } else if (contentType === 'audio') {
        // Generate waveform or audio preview
        const waveformPath = `previews/${artistId}/${fileName}_waveform.png`;
        const waveformBuffer = await this.generateAudioWaveform(buffer);
        await uploadToStorage(waveformBuffer, waveformPath, 'image/png');
        processedFile.preview_path = waveformPath;
        
        // Get audio duration
        processedFile.duration = await this.getAudioDuration(buffer);
      }

      return processedFile;
    } catch (error) {
      console.error('Error processing content upload:', error);
      throw new Error('Failed to process uploaded content');
    }
  }

  // Helper methods

  async getContentById(contentId) {
    const [rows] = await db.execute(`
      SELECT c.*, a.username as artist_name, a.profile_image as artist_avatar
      FROM content c
      LEFT JOIN users a ON c.artist_id = a.id
      WHERE c.id = ? AND c.status != 'deleted'
    `, [contentId]);
    
    if (rows.length === 0) return null;
    
    const content = rows[0];
    content.token_ids = JSON.parse(content.token_ids || '[]');
    content.tags = JSON.parse(content.tags || '[]');
    
    return content;
  }

  async getUserRole(userId) {
    const [rows] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
    return rows.length > 0 ? rows[0].role : 'user';
  }

  async logContentActivity(contentId, userId, activityType, metadata = null) {
    await db.execute(
      'INSERT INTO content_activity (content_id, user_id, activity_type, metadata, created_at) VALUES (?, ?, ?, ?, NOW())',
      [contentId, userId, activityType, metadata]
    );
  }

  async incrementViewCount(contentId) {
    await db.execute('UPDATE content SET view_count = view_count + 1 WHERE id = ?', [contentId]);
  }

  async incrementDownloadCount(contentId) {
    await db.execute('UPDATE content SET download_count = download_count + 1 WHERE id = ?', [contentId]);
  }

  async generateImagePreview(buffer) {
    return await sharp(buffer)
      .resize(300, 300, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer();
  }

  async generateVideoThumbnail(buffer) {
    // Implementation would use ffmpeg to extract thumbnail
    // This is a placeholder - actual implementation would be more complex
    return buffer.slice(0, 1000); // Placeholder
  }

  async generateAudioWaveform(buffer) {
    // Implementation would generate waveform visualization
    // This is a placeholder - actual implementation would use audio processing libraries
    return buffer.slice(0, 1000); // Placeholder
  }

  async getVideoDuration(buffer) {
    // Implementation would use ffmpeg to get video duration
    return null; // Placeholder
  }

  async getAudioDuration(buffer) {
    // Implementation would use audio libraries to get duration
    return null; // Placeholder
  }
}

module.exports = new ContentService();
