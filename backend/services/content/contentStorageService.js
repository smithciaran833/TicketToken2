const AWS = require('aws-sdk');
const { BlobServiceClient } = require('@azure/storage-blob');
const multer = require('multer');
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;
const mime = require('mime-types');
const ContentModel = require('../../models/Content');
const ArtistModel = require('../../models/Artist');
const StorageModel = require('../../models/Storage');
const CacheService = require('../cache/cacheService');
const NotificationService = require('../notifications/notificationService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class ContentStorageService {
  constructor() {
    this.cacheService = new CacheService();
    this.notificationService = new NotificationService();
    
    // Initialize storage providers
    this.initializeStorageProviders();
    
    // Configuration
    this.config = {
      maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB
      supportedFormats: {
        video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'],
        audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'],
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'],
        document: ['pdf', 'doc', 'docx', 'txt']
      },
      thumbnailSizes: [
        { name: 'small', width: 320, height: 180 },
        { name: 'medium', width: 640, height: 360 },
        { name: 'large', width: 1280, height: 720 }
      ],
      videoQualities: [
        { name: '360p', width: 640, height: 360, bitrate: '800k' },
        { name: '480p', width: 854, height: 480, bitrate: '1200k' },
        { name: '720p', width: 1280, height: 720, bitrate: '2500k' },
        { name: '1080p', width: 1920, height: 1080, bitrate: '5000k' },
        { name: '4k', width: 3840, height: 2160, bitrate: '15000k' }
      ],
      cdnRegions: ['us-east', 'us-west', 'eu-west', 'ap-southeast'],
      storageClasses: {
        hot: { name: 'hot', cost: 0.023, description: 'Frequently accessed' },
        cool: { name: 'cool', cost: 0.01, description: 'Infrequent access' },
        archive: { name: 'archive', cost: 0.00099, description: 'Long-term storage' }
      }
    };
    
    // Temporary upload directory
    this.tempDir = process.env.TEMP_UPLOAD_DIR || './temp/uploads';
    this.ensureTempDirectory();
  }

  /**
   * Initialize storage providers (AWS S3, Azure Blob, etc.)
   */
  initializeStorageProviders() {
    // AWS S3
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });
    
    // Azure Blob Storage (optional)
    if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
      this.blobServiceClient = BlobServiceClient.fromConnectionString(
        process.env.AZURE_STORAGE_CONNECTION_STRING
      );
    }
    
    // CloudFront CDN
    this.cloudfront = new AWS.CloudFront({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });
    
    this.primaryBucket = process.env.S3_BUCKET_NAME || 'event-platform-content';
    this.cdnDomain = process.env.CDN_DOMAIN || 'https://cdn.eventplatform.com';
  }

  /**
   * Handle file uploads with validation and processing
   */
  async uploadContent(file, metadata, artistId) {
    const uploadId = crypto.randomBytes(16).toString('hex');
    
    try {
      logger.info('Starting content upload', {
        uploadId,
        filename: file.originalname,
        size: file.size,
        artistId
      });

      // Validate file
      const validation = await this.validateFileFormat(file);
      if (!validation.isValid) {
        throw new AppError(validation.error, 400);
      }

      // Validate artist storage quota
      const storageCheck = await this.checkStorageQuota(artistId, file.size);
      if (!storageCheck.hasSpace) {
        throw new AppError('Storage quota exceeded', 400);
      }

      // Generate unique file key
      const fileKey = this.generateFileKey(file, artistId);
      
      // Calculate file hash for deduplication
      const fileHash = await this.calculateFileHash(file.path || file.buffer);
      
      // Check for duplicate content
      const duplicate = await this.checkDuplicateContent(fileHash, artistId);
      if (duplicate) {
        logger.info('Duplicate content detected, reusing existing file', {
          uploadId,
          existingContentId: duplicate._id
        });
        
        // Create new content entry pointing to existing file
        return await this.createContentEntry({
          ...metadata,
          artistId,
          fileUrl: duplicate.fileUrl,
          fileKey: duplicate.fileKey,
          fileHash,
          isDuplicate: true,
          originalContentId: duplicate._id
        });
      }

      // Upload to primary storage
      const uploadResult = await this.uploadToStorage(file, fileKey, {
        contentType: file.mimetype,
        metadata: {
          uploadId,
          artistId,
          originalName: file.originalname,
          uploadDate: new Date().toISOString()
        }
      });

      // Process based on file type
      let processedData = {};
      const fileType = this.getFileType(file.mimetype);
      
      switch (fileType) {
        case 'video':
          processedData = await this.processVideoUpload(file, fileKey, uploadId);
          break;
        case 'audio':
          processedData = await this.processAudioUpload(file, fileKey, uploadId);
          break;
        case 'image':
          processedData = await this.processImageUpload(file, fileKey, uploadId);
          break;
        default:
          processedData = { processed: false };
      }

      // Create content entry
      const content = await this.createContentEntry({
        uploadId,
        artistId,
        title: metadata.title || file.originalname,
        description: metadata.description,
        type: fileType,
        fileKey,
        fileUrl: uploadResult.url,
        fileSize: file.size,
        mimeType: file.mimetype,
        fileHash,
        duration: processedData.duration,
        dimensions: processedData.dimensions,
        thumbnails: processedData.thumbnails,
        variants: processedData.variants,
        metadata: {
          ...metadata,
          originalName: file.originalname,
          uploadDate: new Date(),
          processingStatus: processedData.processed ? 'completed' : 'pending'
        },
        storage: {
          provider: 'aws_s3',
          bucket: this.primaryBucket,
          region: process.env.AWS_REGION,
          storageClass: 'hot',
          cdnEnabled: true
        }
      });

      // Distribute to CDN
      await this.distributeToCDN(content);

      // Update artist storage usage
      await this.updateStorageUsage(artistId, file.size, 'add');

      // Clean up temporary file
      if (file.path) {
        await this.cleanupTempFile(file.path);
      }

      // Send notification
      await this.notificationService.sendNotification({
        userId: artistId,
        type: 'content_uploaded',
        title: 'Content Upload Complete',
        message: `Your ${fileType} "${content.title}" has been uploaded successfully`,
        data: { contentId: content._id }
      });

      logger.info('Content upload completed', {
        uploadId,
        contentId: content._id,
        processingTime: Date.now() - content.metadata.uploadDate
      });

      return {
        success: true,
        content: await this.getContentWithUrls(content),
        uploadId
      };
    } catch (error) {
      logger.error('Error uploading content:', error);
      
      // Cleanup on error
      if (file.path) {
        await this.cleanupTempFile(file.path);
      }
      
      throw error;
    }
  }

  /**
   * Store content metadata in database
   */
  async storeMetadata(contentData) {
    try {
      const content = new ContentModel(contentData);
      await content.save();
      
      // Clear caches
      await this.cacheService.delete(`content:${contentData.artistId}:*`);
      
      return content;
    } catch (error) {
      logger.error('Error storing metadata:', error);
      throw error;
    }
  }

  /**
   * Generate thumbnails for video content
   */
  async generateThumbnails(videoFile) {
    const thumbnails = [];
    
    try {
      for (const size of this.config.thumbnailSizes) {
        const thumbnailKey = `${path.parse(videoFile.key).name}_thumb_${size.name}.jpg`;
        const thumbnailPath = path.join(this.tempDir, thumbnailKey);
        
        // Extract frame at 10% of video duration
        await new Promise((resolve, reject) => {
          ffmpeg(videoFile.path || videoFile.url)
            .screenshots({
              timestamps: ['10%'],
              filename: thumbnailKey,
              folder: this.tempDir,
              size: `${size.width}x${size.height}`
            })
            .on('end', resolve)
            .on('error', reject);
        });
        
        // Upload thumbnail
        const uploadResult = await this.uploadToStorage(
          { path: thumbnailPath, mimetype: 'image/jpeg' },
          `thumbnails/${thumbnailKey}`,
          { contentType: 'image/jpeg' }
        );
        
        thumbnails.push({
          size: size.name,
          width: size.width,
          height: size.height,
          url: uploadResult.url,
          key: uploadResult.key
        });
        
        // Cleanup temp file
        await this.cleanupTempFile(thumbnailPath);
      }
      
      return thumbnails;
    } catch (error) {
      logger.error('Error generating thumbnails:', error);
      throw error;
    }
  }

  /**
   * Process video transcoding for multiple quality versions
   */
  async processVideoTranscoding(videoFile) {
    const variants = [];
    const videoInfo = await this.getVideoInfo(videoFile.path || videoFile.url);
    
    try {
      // Determine which qualities to generate based on source
      const qualitiesToGenerate = this.config.videoQualities.filter(
        quality => quality.height <= videoInfo.height
      );
      
      for (const quality of qualitiesToGenerate) {
        const variantKey = `${path.parse(videoFile.key).name}_${quality.name}.mp4`;
        const variantPath = path.join(this.tempDir, variantKey);
        
        logger.info(`Transcoding video to ${quality.name}`, {
          source: videoFile.key,
          quality: quality.name
        });
        
        // Transcode video
        await new Promise((resolve, reject) => {
          ffmpeg(videoFile.path || videoFile.url)
            .output(variantPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .size(`${quality.width}x${quality.height}`)
            .videoBitrate(quality.bitrate)
            .outputOptions([
              '-preset fast',
              '-crf 22',
              '-movflags +faststart'
            ])
            .on('end', resolve)
            .on('error', reject)
            .on('progress', (progress) => {
              logger.debug(`Transcoding progress: ${progress.percent}%`);
            })
            .run();
        });
        
        // Get file size
        const stats = await fs.stat(variantPath);
        
        // Upload variant
        const uploadResult = await this.uploadToStorage(
          { path: variantPath, mimetype: 'video/mp4' },
          `videos/${quality.name}/${variantKey}`,
          { contentType: 'video/mp4' }
        );
        
        variants.push({
          quality: quality.name,
          width: quality.width,
          height: quality.height,
          bitrate: quality.bitrate,
          size: stats.size,
          url: uploadResult.url,
          key: uploadResult.key
        });
        
        // Cleanup temp file
        await this.cleanupTempFile(variantPath);
      }
      
      // Generate HLS playlist for adaptive streaming
      const hlsVariant = await this.generateHLSStream(videoFile, variants);
      if (hlsVariant) {
        variants.push(hlsVariant);
      }
      
      return variants;
    } catch (error) {
      logger.error('Error transcoding video:', error);
      throw error;
    }
  }

  /**
   * Validate file format and requirements
   */
  async validateFileFormat(file) {
    const errors = [];
    
    // Check file size
    if (file.size > this.config.maxFileSize) {
      errors.push(`File size exceeds maximum of ${this.config.maxFileSize / (1024 * 1024 * 1024)}GB`);
    }
    
    // Check file extension
    const extension = path.extname(file.originalname).toLowerCase().slice(1);
    const fileType = this.getFileType(file.mimetype);
    
    if (!fileType) {
      errors.push('Unsupported file type');
    } else if (!this.config.supportedFormats[fileType].includes(extension)) {
      errors.push(`Unsupported ${fileType} format: ${extension}`);
    }
    
    // Validate MIME type
    const detectedMime = mime.lookup(file.originalname);
    if (detectedMime !== file.mimetype) {
      logger.warn('MIME type mismatch', {
        provided: file.mimetype,
        detected: detectedMime
      });
    }
    
    // Scan for malware (if service available)
    if (process.env.ENABLE_MALWARE_SCAN === 'true') {
      const scanResult = await this.scanForMalware(file);
      if (!scanResult.clean) {
        errors.push('File failed security scan');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null,
      fileType,
      extension
    };
  }

  /**
   * Calculate storage costs based on file size and type
   */
  async calculateStorageCosts(file) {
    try {
      const fileSize = file.size || 0;
      const fileSizeGB = fileSize / (1024 * 1024 * 1024);
      const fileType = this.getFileType(file.mimetype);
      
      // Base storage costs
      const storageCosts = {
        hot: fileSizeGB * this.config.storageClasses.hot.cost * 30, // Monthly
        cool: fileSizeGB * this.config.storageClasses.cool.cost * 30,
        archive: fileSizeGB * this.config.storageClasses.archive.cost * 30
      };
      
      // Bandwidth costs (estimated)
      const estimatedViews = this.estimateMonthlyViews(fileType);
      const bandwidthGB = fileSizeGB * estimatedViews;
      const bandwidthCost = bandwidthGB * 0.085; // $0.085 per GB
      
      // Processing costs
      let processingCost = 0;
      if (fileType === 'video') {
        // Video transcoding costs
        const duration = await this.estimateVideoDuration(file);
        processingCost = duration * 0.015 * this.config.videoQualities.length; // $0.015 per minute per quality
      } else if (fileType === 'image') {
        processingCost = 0.01; // Fixed cost for image processing
      }
      
      // CDN distribution costs
      const cdnCost = this.config.cdnRegions.length * 0.50; // $0.50 per region per month
      
      // Calculate totals
      const monthlyCost = storageCosts.hot + bandwidthCost + cdnCost;
      const oneTimeCost = processingCost;
      const annualCost = (monthlyCost * 12) + oneTimeCost;
      
      return {
        breakdown: {
          storage: storageCosts,
          bandwidth: {
            estimatedGB: bandwidthGB,
            cost: bandwidthCost
          },
          processing: processingCost,
          cdn: cdnCost
        },
        totals: {
          monthly: Math.round(monthlyCost * 100) / 100,
          oneTime: Math.round(oneTimeCost * 100) / 100,
          annual: Math.round(annualCost * 100) / 100
        },
        recommendations: this.generateCostRecommendations(file, monthlyCost)
      };
    } catch (error) {
      logger.error('Error calculating storage costs:', error);
      throw error;
    }
  }

  /**
   * Organize content library for an artist
   */
  async organizeContentLibrary(artistId) {
    try {
      // Get all content for artist
      const content = await ContentModel.find({ artistId }).lean();
      
      // Organize by type and date
      const organized = {
        videos: [],
        audio: [],
        images: [],
        documents: [],
        stats: {
          totalFiles: content.length,
          totalSize: 0,
          byType: {},
          byYear: {},
          duplicates: []
        }
      };
      
      // Process each content item
      for (const item of content) {
        // Categorize by type
        organized[`${item.type}s`]?.push(item);
        
        // Update stats
        organized.stats.totalSize += item.fileSize || 0;
        organized.stats.byType[item.type] = (organized.stats.byType[item.type] || 0) + 1;
        
        // Organize by year
        const year = new Date(item.createdAt).getFullYear();
        organized.stats.byYear[year] = (organized.stats.byYear[year] || 0) + 1;
        
        // Check for duplicates
        if (item.isDuplicate) {
          organized.stats.duplicates.push({
            id: item._id,
            originalId: item.originalContentId,
            title: item.title
          });
        }
      }
      
      // Generate folder structure recommendations
      const folderStructure = {
        root: `artists/${artistId}`,
        structure: {
          videos: {
            raw: 'videos/raw',
            processed: 'videos/processed',
            thumbnails: 'videos/thumbnails'
          },
          audio: {
            masters: 'audio/masters',
            compressed: 'audio/compressed'
          },
          images: {
            original: 'images/original',
            optimized: 'images/optimized'
          },
          documents: 'documents'
        }
      };
      
      // Apply organization if requested
      if (process.env.AUTO_ORGANIZE === 'true') {
        await this.applyOrganization(artistId, organized, folderStructure);
      }
      
      return {
        organized,
        folderStructure,
        recommendations: await this.generateOrganizationRecommendations(organized)
      };
    } catch (error) {
      logger.error('Error organizing content library:', error);
      throw error;
    }
  }

  /**
   * Create redundant backup copies of content
   */
  async backupContent(contentId) {
    try {
      const content = await ContentModel.findById(contentId);
      if (!content) {
        throw new AppError('Content not found', 404);
      }
      
      logger.info('Starting content backup', { contentId });
      
      // Check if already backed up
      if (content.backup && content.backup.status === 'completed') {
        return {
          success: true,
          message: 'Content already backed up',
          backup: content.backup
        };
      }
      
      const backupLocations = [];
      
      // Backup to secondary region
      if (process.env.BACKUP_REGION && process.env.BACKUP_BUCKET) {
        const secondaryBackup = await this.backupToRegion(
          content,
          process.env.BACKUP_REGION,
          process.env.BACKUP_BUCKET
        );
        backupLocations.push(secondaryBackup);
      }
      
      // Backup to cold storage
      const coldBackup = await this.backupToColdStorage(content);
      backupLocations.push(coldBackup);
      
      // Backup to alternative provider (e.g., Azure)
      if (this.blobServiceClient) {
        const azureBackup = await this.backupToAzure(content);
        backupLocations.push(azureBackup);
      }
      
      // Update content with backup info
      content.backup = {
        status: 'completed',
        locations: backupLocations,
        lastBackupDate: new Date(),
        nextScheduledBackup: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };
      
      await content.save();
      
      // Clear caches
      await this.cacheService.delete(`content:${contentId}`);
      
      logger.info('Content backup completed', {
        contentId,
        locations: backupLocations.length
      });
      
      return {
        success: true,
        backup: content.backup,
        locations: backupLocations
      };
    } catch (error) {
      logger.error('Error backing up content:', error);
      throw error;
    }
  }

  /**
   * Delete content and cleanup all associated files
   */
  async deleteContent(contentId) {
    try {
      const content = await ContentModel.findById(contentId);
      if (!content) {
        throw new AppError('Content not found', 404);
      }
      
      logger.info('Starting content deletion', { contentId });
      
      // Soft delete first (mark as deleted)
      content.status = 'deleted';
      content.deletedAt = new Date();
      await content.save();
      
      // Schedule hard delete after grace period
      const gracePeriod = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      setTimeout(async () => {
        try {
          // Delete from primary storage
          await this.deleteFromStorage(content.fileKey);
          
          // Delete thumbnails
          if (content.thumbnails) {
            for (const thumbnail of content.thumbnails) {
              await this.deleteFromStorage(thumbnail.key);
            }
          }
          
          // Delete variants
          if (content.variants) {
            for (const variant of content.variants) {
              await this.deleteFromStorage(variant.key);
            }
          }
          
          // Delete backups
          if (content.backup && content.backup.locations) {
            for (const location of content.backup.locations) {
              await this.deleteBackup(location);
            }
          }
          
          // Invalidate CDN cache
          await this.invalidateCDNCache(content);
          
          // Update storage usage
          await this.updateStorageUsage(content.artistId, -content.fileSize, 'remove');
          
          // Hard delete from database
          await ContentModel.findByIdAndDelete(contentId);
          
          logger.info('Content hard deletion completed', { contentId });
        } catch (error) {
          logger.error('Error during hard deletion:', error);
        }
      }, gracePeriod);
      
      // Clear caches
      await this.cacheService.delete(`content:${contentId}`);
      await this.cacheService.delete(`content:${content.artistId}:*`);
      
      // Send notification
      await this.notificationService.sendNotification({
        userId: content.artistId,
        type: 'content_deleted',
        title: 'Content Deleted',
        message: `"${content.title}" has been deleted and will be permanently removed in 30 days`,
        data: { contentId }
      });
      
      return {
        success: true,
        message: 'Content marked for deletion',
        permanentDeletionDate: new Date(Date.now() + gracePeriod)
      };
    } catch (error) {
      logger.error('Error deleting content:', error);
      throw error;
    }
  }

  /**
   * Get storage analytics for an artist
   */
  async getStorageAnalytics(artistId) {
    try {
      const cacheKey = `storage:analytics:${artistId}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;
      
      // Get all content
      const content = await ContentModel.find({ 
        artistId,
        status: { $ne: 'deleted' }
      }).lean();
      
      // Get storage record
      const storage = await StorageModel.findOne({ artistId }) || {
        usedSpace: 0,
        quota: 100 * 1024 * 1024 * 1024, // 100GB default
        lastUpdated: new Date()
      };
      
      // Calculate analytics
      const analytics = {
        summary: {
          totalFiles: content.length,
          totalSize: content.reduce((sum, c) => sum + (c.fileSize || 0), 0),
          usedQuota: storage.usedSpace,
          availableQuota: storage.quota - storage.usedSpace,
          quotaPercentage: (storage.usedSpace / storage.quota) * 100
        },
        breakdown: {
          byType: {},
          byMonth: {},
          byStorageClass: {}
        },
        trends: {
          last30Days: await this.getStorageTrend(artistId, 30),
          last90Days: await this.getStorageTrend(artistId, 90),
          monthlyGrowth: 0
        },
        costs: {
          current: await this.calculateCurrentCosts(artistId),
          projected: await this.projectFutureCosts(artistId)
        },
        optimization: {
          recommendations: [],
          potentialSavings: 0
        }
      };
      
      // Process content for breakdown
      content.forEach(item => {
        // By type
        if (!analytics.breakdown.byType[item.type]) {
          analytics.breakdown.byType[item.type] = {
            count: 0,
            size: 0,
            percentage: 0
          };
        }
        analytics.breakdown.byType[item.type].count++;
        analytics.breakdown.byType[item.type].size += item.fileSize || 0;
        
        // By month
        const month = new Date(item.createdAt).toISOString().slice(0, 7);
        if (!analytics.breakdown.byMonth[month]) {
          analytics.breakdown.byMonth[month] = {
            count: 0,
            size: 0,
            uploads: 0,
            deletions: 0
          };
        }
        analytics.breakdown.byMonth[month].count++;
        analytics.breakdown.byMonth[month].size += item.fileSize || 0;
        analytics.breakdown.byMonth[month].uploads++;
        
        // By storage class
        const storageClass = item.storage?.storageClass || 'hot';
        if (!analytics.breakdown.byStorageClass[storageClass]) {
          analytics.breakdown.byStorageClass[storageClass] = {
            count: 0,
            size: 0,
            monthlyCost: 0
          };
        }
        analytics.breakdown.byStorageClass[storageClass].count++;
        analytics.breakdown.byStorageClass[storageClass].size += item.fileSize || 0;
      });
      
      // Calculate percentages
      Object.keys(analytics.breakdown.byType).forEach(type => {
        analytics.breakdown.byType[type].percentage = 
          (analytics.breakdown.byType[type].size / analytics.summary.totalSize) * 100;
      });
      
      // Calculate storage class costs
      Object.keys(analytics.breakdown.byStorageClass).forEach(className => {
        const classData = analytics.breakdown.byStorageClass[className];
        const classConfig = this.config.storageClasses[className];
        if (classConfig) {
          classData.monthlyCost = (classData.size / (1024 * 1024 * 1024)) * classConfig.cost * 30;
        }
      });
      
      // Generate optimization recommendations
      analytics.optimization = await this.generateOptimizationRecommendations(
        content,
        analytics
      );
      
      // Calculate monthly growth
      const months = Object.keys(analytics.breakdown.byMonth).sort();
      if (months.length >= 2) {
        const lastMonth = analytics.breakdown.byMonth[months[months.length - 1]];
        const previousMonth = analytics.breakdown.byMonth[months[months.length - 2]];
        analytics.trends.monthlyGrowth = previousMonth.size > 0 ?
          ((lastMonth.size - previousMonth.size) / previousMonth.size) * 100 : 0;
      }
      
      // Cache for 5 minutes
      await this.cacheService.set(cacheKey, analytics, 300);
      
      return analytics;
    } catch (error) {
      logger.error('Error getting storage analytics:', error);
      throw error;
    }
  }

  // Helper methods

  async ensureTempDirectory() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('Error creating temp directory:', error);
    }
  }

  generateFileKey(file, artistId) {
    const timestamp = Date.now();
    const hash = crypto.randomBytes(8).toString('hex');
    const extension = path.extname(file.originalname);
    const sanitizedName = file.originalname
      .replace(extension, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .toLowerCase();
    
    return `artists/${artistId}/${timestamp}_${hash}_${sanitizedName}${extension}`;
  }

  async calculateFileHash(filePath) {
    const hash = crypto.createHash('sha256');
    
    if (Buffer.isBuffer(filePath)) {
      hash.update(filePath);
    } else {
      const stream = require('fs').createReadStream(filePath);
      for await (const chunk of stream) {
        hash.update(chunk);
      }
    }
    
    return hash.digest('hex');
  }

  async checkDuplicateContent(fileHash, artistId) {
    return await ContentModel.findOne({
      fileHash,
      artistId,
      status: { $ne: 'deleted' }
    });
  }

  async uploadToStorage(file, key, options = {}) {
    const params = {
      Bucket: this.primaryBucket,
      Key: key,
      Body: file.buffer || require('fs').createReadStream(file.path),
      ContentType: options.contentType || file.mimetype,
      Metadata: options.metadata || {},
      ServerSideEncryption: 'AES256',
      StorageClass: options.storageClass || 'STANDARD'
    };
    
    // Add cache control for static assets
    if (this.isStaticAsset(file.mimetype)) {
      params.CacheControl = 'max-age=31536000'; // 1 year
    }
    
    const result = await this.s3.upload(params).promise();
    
    return {
      url: result.Location,
      key: result.Key,
      etag: result.ETag,
      bucket: result.Bucket
    };
  }

  getFileType(mimetype) {
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.includes('pdf') || mimetype.includes('document')) return 'document';
    return null;
  }

  isStaticAsset(mimetype) {
    return mimetype.startsWith('image/') || 
           mimetype.includes('pdf') ||
           mimetype.includes('font');
  }

  async processVideoUpload(file, fileKey, uploadId) {
    try {
      // Get video information
      const videoInfo = await this.getVideoInfo(file.path || file.url);
      
      // Generate thumbnails
      const thumbnails = await this.generateThumbnails({
        path: file.path,
        url: file.url,
        key: fileKey
      });
      
      // Start transcoding job
      const transcodingJob = this.startTranscodingJob(file, fileKey, uploadId);
      
      return {
        processed: true,
        duration: videoInfo.duration,
        dimensions: {
          width: videoInfo.width,
          height: videoInfo.height
        },
        thumbnails,
        variants: [], // Will be populated by background job
        transcodingJobId: transcodingJob.id
      };
    } catch (error) {
      logger.error('Error processing video upload:', error);
      return { processed: false, error: error.message };
    }
  }

  async processAudioUpload(file, fileKey, uploadId) {
    try {
      // Get audio information
      const audioInfo = await this.getAudioInfo(file.path || file.url);
      
      // Generate waveform
      const waveform = await this.generateWaveform(file);
      
      // Create compressed versions
      const variants = await this.createAudioVariants(file, fileKey);
      
      return {
        processed: true,
        duration: audioInfo.duration,
        bitrate: audioInfo.bitrate,
        sampleRate: audioInfo.sampleRate,
        waveform,
        variants
      };
    } catch (error) {
      logger.error('Error processing audio upload:', error);
      return { processed: false, error: error.message };
    }
  }

  async processImageUpload(file, fileKey, uploadId) {
    try {
      // Get image information
      const imageInfo = await sharp(file.path || file.buffer).metadata();
      
      // Create optimized versions
      const variants = await this.createImageVariants(file, fileKey);
      
      return {
        processed: true,
        dimensions: {
          width: imageInfo.width,
          height: imageInfo.height
        },
        format: imageInfo.format,
        variants
      };
    } catch (error) {
      logger.error('Error processing image upload:', error);
      return { processed: false, error: error.message };
    }
  }

  async getVideoInfo(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        
        const video = metadata.streams.find(s => s.codec_type === 'video');
        resolve({
          duration: metadata.format.duration,
          width: video?.width || 0,
          height: video?.height || 0,
          bitrate: metadata.format.bit_rate,
          codec: video?.codec_name
        });
      });
    });
  }

  async createContentEntry(data) {
    const content = new ContentModel(data);
    await content.save();
    
    // Clear caches
    await this.cacheService.delete(`content:${data.artistId}:*`);
    
    return content;
  }

  async distributeToCDN(content) {
    try {
      // Create CloudFront invalidation for dynamic content
      if (content.type === 'video' || content.type === 'audio') {
        const invalidation = await this.cloudfront.createInvalidation({
          DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
          InvalidationBatch: {
            CallerReference: `${content._id}-${Date.now()}`,
            Paths: {
              Quantity: 1,
              Items: [`/artists/${content.artistId}/*`]
            }
          }
        }).promise();
        
        logger.info('CDN invalidation created', {
          contentId: content._id,
          invalidationId: invalidation.Invalidation.Id
        });
      }
      
      // Pre-warm edge locations for popular content
      if (content.metadata?.featured || content.metadata?.priority === 'high') {
        await this.prewarmCDN(content);
      }
    } catch (error) {
      logger.error('Error distributing to CDN:', error);
    }
  }

  async updateStorageUsage(artistId, sizeChange, operation) {
    try {
      const update = operation === 'add' ? 
        { $inc: { usedSpace: sizeChange } } :
        { $inc: { usedSpace: -Math.abs(sizeChange) } };
      
      await StorageModel.findOneAndUpdate(
        { artistId },
        {
          ...update,
          lastUpdated: new Date()
        },
        { upsert: true }
      );
    } catch (error) {
      logger.error('Error updating storage usage:', error);
    }
  }

  async cleanupTempFile(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logger.error('Error cleaning up temp file:', error);
    }
  }

  async getContentWithUrls(content) {
    // Generate signed URLs for private content
    const urls = {
      primary: content.fileUrl
    };
    
    if (content.metadata?.private) {
      urls.primary = await this.generateSignedUrl(content.fileKey);
      
      if (content.thumbnails) {
        urls.thumbnails = {};
        for (const thumb of content.thumbnails) {
          urls.thumbnails[thumb.size] = await this.generateSignedUrl(thumb.key);
        }
      }
      
      if (content.variants) {
        urls.variants = {};
        for (const variant of content.variants) {
          urls.variants[variant.quality || variant.size] = 
            await this.generateSignedUrl(variant.key);
        }
      }
    } else {
      // Use CDN URLs for public content
      urls.primary = `${this.cdnDomain}/${content.fileKey}`;
      
      if (content.thumbnails) {
        urls.thumbnails = {};
        for (const thumb of content.thumbnails) {
          urls.thumbnails[thumb.size] = `${this.cdnDomain}/${thumb.key}`;
        }
      }
      
      if (content.variants) {
        urls.variants = {};
        for (const variant of content.variants) {
          urls.variants[variant.quality || variant.size] = 
            `${this.cdnDomain}/${variant.key}`;
        }
      }
    }
    
    return {
      ...content.toObject ? content.toObject() : content,
      urls
    };
  }

  async generateSignedUrl(key, expiresIn = 3600) {
    const params = {
      Bucket: this.primaryBucket,
      Key: key,
      Expires: expiresIn
    };
    
    return await this.s3.getSignedUrlPromise('getObject', params);
  }

  async checkStorageQuota(artistId, additionalSize) {
    const storage = await StorageModel.findOne({ artistId });
    
    if (!storage) {
      // Create default storage record
      await StorageModel.create({
        artistId,
        quota: 100 * 1024 * 1024 * 1024, // 100GB default
        usedSpace: 0
      });
      return { hasSpace: true, available: 100 * 1024 * 1024 * 1024 };
    }
    
    const available = storage.quota - storage.usedSpace;
    return {
      hasSpace: available >= additionalSize,
      available,
      quota: storage.quota,
      used: storage.usedSpace
    };
  }

  async scanForMalware(file) {
    // Integrate with malware scanning service
    // For now, return clean
    return { clean: true };
  }

  estimateMonthlyViews(fileType) {
    // Estimate based on file type and historical data
    const estimates = {
      video: 1000,
      audio: 500,
      image: 2000,
      document: 100
    };
    
    return estimates[fileType] || 100;
  }

  async estimateVideoDuration(file) {
    try {
      const info = await this.getVideoInfo(file.path || file.url);
      return info.duration / 60; // Convert to minutes
    } catch (error) {
      return 5; // Default 5 minutes
    }
  }

  generateCostRecommendations(file, monthlyCost) {
    const recommendations = [];
    
    if (monthlyCost > 10) {
      recommendations.push({
        type: 'cost_optimization',
        message: 'Consider using adaptive bitrate streaming to reduce bandwidth costs'
      });
    }
    
    const fileType = this.getFileType(file.mimetype);
    if (fileType === 'video' && file.size > 1024 * 1024 * 1024) {
      recommendations.push({
        type: 'compression',
        message: 'Large video file detected. Consider compressing before upload'
      });
    }
    
    return recommendations;
  }

  startTranscodingJob(file, fileKey, uploadId) {
    // Queue transcoding job
    // In production, use job queue like Bull or SQS
    const jobId = crypto.randomBytes(16).toString('hex');
    
    setImmediate(async () => {
      try {
        const variants = await this.processVideoTranscoding({
          path: file.path,
          url: file.url,
          key: fileKey
        });
        
        // Update content with variants
        await ContentModel.findOneAndUpdate(
          { uploadId },
          {
            variants,
            'metadata.processingStatus': 'completed',
            'metadata.processedAt': new Date()
          }
        );
        
        logger.info('Transcoding job completed', { jobId, uploadId });
      } catch (error) {
        logger.error('Transcoding job failed', { jobId, error });
        
        await ContentModel.findOneAndUpdate(
          { uploadId },
          {
            'metadata.processingStatus': 'failed',
            'metadata.processingError': error.message
          }
        );
      }
    });
    
    return { id: jobId };
  }

  async generateHLSStream(videoFile, variants) {
    // Generate HLS playlist for adaptive streaming
    // Implementation depends on specific requirements
    return null;
  }

  async getAudioInfo(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) return reject(err);
        
        const audio = metadata.streams.find(s => s.codec_type === 'audio');
        resolve({
          duration: metadata.format.duration,
          bitrate: audio?.bit_rate || metadata.format.bit_rate,
          sampleRate: audio?.sample_rate,
          channels: audio?.channels,
          codec: audio?.codec_name
        });
      });
    });
  }

  async generateWaveform(file) {
    // Generate waveform data for audio visualization
    // Use tools like audiowaveform or wavesurfer
    return {
      peaks: [],
      duration: 0
    };
  }

  async createAudioVariants(file, fileKey) {
    // Create different quality versions of audio
    const variants = [];
    
    // Implementation for MP3, AAC variants
    
    return variants;
  }

  async createImageVariants(file, fileKey) {
    const variants = [];
    const sizes = [
      { name: 'thumb', width: 200 },
      { name: 'small', width: 400 },
      { name: 'medium', width: 800 },
      { name: 'large', width: 1600 }
    ];
    
    for (const size of sizes) {
      const variantKey = `${path.parse(fileKey).name}_${size.name}.webp`;
      const variantPath = path.join(this.tempDir, variantKey);
      
      await sharp(file.path || file.buffer)
        .resize(size.width, null, { withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(variantPath);
      
      const stats = await fs.stat(variantPath);
      
      const uploadResult = await this.uploadToStorage(
        { path: variantPath, mimetype: 'image/webp' },
        `images/${size.name}/${variantKey}`,
        { contentType: 'image/webp' }
      );
      
      variants.push({
        size: size.name,
        width: size.width,
        format: 'webp',
        fileSize: stats.size,
        url: uploadResult.url,
        key: uploadResult.key
      });
      
      await this.cleanupTempFile(variantPath);
    }
    
    return variants;
  }

  async backupToRegion(content, region, bucket) {
    // Implement cross-region replication
    return {
      provider: 'aws_s3',
      region,
      bucket,
      key: content.fileKey,
      status: 'completed',
      date: new Date()
    };
  }

  async backupToColdStorage(content) {
    // Move to Glacier or similar
    const glacierParams = {
      Bucket: this.primaryBucket,
      Key: content.fileKey,
      StorageClass: 'GLACIER'
    };
    
    await this.s3.copyObject({
      ...glacierParams,
      CopySource: `${this.primaryBucket}/${content.fileKey}`
    }).promise();
    
    return {
      provider: 'aws_glacier',
      key: content.fileKey,
      status: 'completed',
      date: new Date()
    };
  }

  async backupToAzure(content) {
    // Implement Azure backup
    return {
      provider: 'azure_blob',
      container: 'backups',
      blob: content.fileKey,
      status: 'completed',
      date: new Date()
    };
  }

  async deleteFromStorage(key) {
    await this.s3.deleteObject({
      Bucket: this.primaryBucket,
      Key: key
    }).promise();
  }

  async deleteBackup(location) {
    // Implement backup deletion based on provider
    logger.info('Deleting backup', location);
  }

  async invalidateCDNCache(content) {
    // Invalidate CloudFront cache
    if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
      await this.cloudfront.createInvalidation({
        DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
          CallerReference: `delete-${content._id}-${Date.now()}`,
          Paths: {
            Quantity: 1,
            Items: [`/${content.fileKey}*`]
          }
        }
      }).promise();
    }
  }

  async getStorageTrend(artistId, days) {
    // Implement storage trend calculation
    return {
      growth: 0,
      averageDaily: 0,
      projection: 0
    };
  }

  async calculateCurrentCosts(artistId) {
    // Calculate current monthly costs
    return {
      storage: 0,
      bandwidth: 0,
      processing: 0,
      total: 0
    };
  }

  async projectFutureCosts(artistId) {
    // Project costs based on trends
    return {
      nextMonth: 0,
      nextQuarter: 0,
      nextYear: 0
    };
  }

  async generateOptimizationRecommendations(content, analytics) {
    const recommendations = [];
    let potentialSavings = 0;
    
    // Check for old content that can be archived
    const oldContent = content.filter(c => {
      const age = Date.now() - new Date(c.createdAt).getTime();
      return age > 180 * 24 * 60 * 60 * 1000; // 6 months
    });
    
    if (oldContent.length > 0) {
      const savingsPerGB = this.config.storageClasses.hot.cost - this.config.storageClasses.archive.cost;
      const oldContentSize = oldContent.reduce((sum, c) => sum + c.fileSize, 0) / (1024 * 1024 * 1024);
      const monthlySavings = oldContentSize * savingsPerGB * 30;
      
      recommendations.push({
        type: 'archive_old_content',
        message: `Archive ${oldContent.length} files older than 6 months`,
        impact: `Save $${monthlySavings.toFixed(2)}/month`,
        items: oldContent.map(c => ({ id: c._id, title: c.title, size: c.fileSize }))
      });
      
      potentialSavings += monthlySavings;
    }
    
    // Check for duplicates
    const duplicates = content.filter(c => c.isDuplicate);
    if (duplicates.length > 0) {
      const duplicateSize = duplicates.reduce((sum, c) => sum + c.fileSize, 0);
      recommendations.push({
        type: 'remove_duplicates',
        message: `${duplicates.length} duplicate files found`,
        impact: `Free up ${(duplicateSize / (1024 * 1024 * 1024)).toFixed(2)}GB`,
        items: duplicates.map(c => ({ id: c._id, title: c.title }))
      });
    }
    
    return {
      recommendations,
      potentialSavings
    };
  }

  async prewarmCDN(content) {
    // Pre-warm CDN edge locations for better performance
    const regions = this.config.cdnRegions;
    
    for (const region of regions) {
      // Make HEAD request to CDN endpoint to cache content
      // Implementation depends on CDN provider
    }
  }

  async applyOrganization(artistId, organized, folderStructure) {
    // Apply folder organization to existing content
    // This would involve updating file keys and moving files
    logger.info('Applying organization', { artistId });
  }

  async generateOrganizationRecommendations(organized) {
    const recommendations = [];
    
    if (organized.stats.duplicates.length > 5) {
      recommendations.push({
        type: 'duplicates',
        message: 'Consider removing duplicate files to save storage space',
        count: organized.stats.duplicates.length
      });
    }
    
    if (organized.videos.length > 50) {
      recommendations.push({
        type: 'categorization',
        message: 'Consider categorizing videos by event or date for better organization',
        count: organized.videos.length
      });
    }
    
    return recommendations;
  }
}

module.exports = new ContentStorageService();
