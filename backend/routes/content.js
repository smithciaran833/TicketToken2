const express = require('express');
const router = express.Router();
const Joi = require('joi');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');

// Import utilities
const { ResponseFormatter } = require('../utils/responseFormatter');
const { logger, logBusinessEvent } = require('../utils/logger');
const { PAGINATION, USER_ROLES, PERMISSIONS, FILE_UPLOAD } = require('../utils/constants');
const { sanitizeInput, generateId } = require('../utils/helpers');

// Import middleware
const authMiddleware = require('../middleware/auth');
const permissionMiddleware = require('../middleware/permissions');
const validationMiddleware = require('../middleware/validation');
const cacheMiddleware = require('../middleware/cache');
const nftGateMiddleware = require('../middleware/nftGate');

// Import controllers
const contentController = require('../controllers/contentController');
const nftController = require('../controllers/nftController');
const ticketController = require('../controllers/ticketController');
const streamingController = require('../controllers/streamingController');
const analyticsController = require('../controllers/analyticsController');

// =============================================================================
// FILE UPLOAD CONFIGURATION
// =============================================================================

/**
 * Multer configuration for content uploads
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let uploadPath = FILE_UPLOAD.STORAGE_PATHS.TEMP;
    
    // Determine upload path based on content type
    if (file.mimetype.startsWith('image/')) {
      uploadPath = path.join(FILE_UPLOAD.STORAGE_PATHS.EVENTS, 'images');
    } else if (file.mimetype.startsWith('video/')) {
      uploadPath = path.join(FILE_UPLOAD.STORAGE_PATHS.EVENTS, 'videos');
    } else if (file.mimetype.startsWith('audio/')) {
      uploadPath = path.join(FILE_UPLOAD.STORAGE_PATHS.EVENTS, 'audio');
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${generateId(8)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: FILE_UPLOAD.MAX_FILE_SIZE.VIDEO, // Use largest limit
    files: 5 // Max 5 files per upload
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      ...FILE_UPLOAD.ALLOWED_TYPES.IMAGES,
      ...FILE_UPLOAD.ALLOWED_TYPES.VIDEOS,
      ...FILE_UPLOAD.ALLOWED_TYPES.AUDIO,
      ...FILE_UPLOAD.ALLOWED_TYPES.DOCUMENTS
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'), false);
    }
  }
});

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

/**
 * Content query parameters validation
 */
const contentQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().valid('title', 'date', 'views', 'rating', 'duration').default('date'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  type: Joi.string().valid('video', 'audio', 'image', 'document', 'stream').optional(),
  category: Joi.string().optional(),
  artist: Joi.string().optional(),
  event: Joi.string().optional(),
  accessLevel: Joi.string().valid('public', 'premium', 'exclusive', 'nft_gated').optional(),
  search: Joi.string().trim().min(2).max(100).optional(),
  tags: Joi.array().items(Joi.string().trim().max(50)).max(10).optional(),
  minDuration: Joi.number().min(0).optional(),
  maxDuration: Joi.number().min(0).optional(),
  hasSubtitles: Joi.boolean().optional(),
  quality: Joi.string().valid('360p', '480p', '720p', '1080p', '4k').optional()
});

/**
 * Content creation validation schema
 */
const createContentSchema = Joi.object({
  title: Joi.string()
    .trim()
    .min(3)
    .max(200)
    .required()
    .messages({
      'string.min': 'Content title must be at least 3 characters long',
      'string.max': 'Content title must not exceed 200 characters'
    }),
  
  description: Joi.string()
    .trim()
    .min(10)
    .max(2000)
    .required(),
  
  type: Joi.string()
    .valid('video', 'audio', 'image', 'document', 'livestream')
    .required(),
  
  category: Joi.string()
    .valid('music', 'video', 'podcast', 'interview', 'behind_scenes', 'tutorial', 'performance', 'documentary')
    .required(),
  
  accessLevel: Joi.string()
    .valid('public', 'premium', 'exclusive', 'nft_gated')
    .default('public'),
  
  accessRequirements: Joi.object({
    ticketRequired: Joi.boolean().default(false),
    eventId: Joi.string().when('ticketRequired', { is: true, then: Joi.required() }),
    nftRequired: Joi.boolean().default(false),
    contractAddress: Joi.string().when('nftRequired', { is: true, then: Joi.required() }),
    tokenIds: Joi.array().items(Joi.number()).when('nftRequired', { is: true, then: Joi.optional() }),
    minimumBalance: Joi.number().min(1).when('nftRequired', { is: true, then: Joi.optional() }),
    premiumTier: Joi.string().valid('basic', 'premium', 'vip').optional()
  }).optional(),
  
  tags: Joi.array()
    .items(Joi.string().trim().min(2).max(50))
    .max(20)
    .optional(),
  
  metadata: Joi.object({
    duration: Joi.number().min(0).optional(), // in seconds
    bitrate: Joi.number().min(0).optional(),
    resolution: Joi.string().optional(),
    fileSize: Joi.number().min(0).optional(),
    format: Joi.string().optional(),
    language: Joi.string().length(2).optional(),
    subtitles: Joi.array().items(Joi.string()).optional(),
    chapters: Joi.array().items(
      Joi.object({
        title: Joi.string().required(),
        startTime: Joi.number().min(0).required(),
        endTime: Joi.number().min(0).required()
      })
    ).optional()
  }).optional(),
  
  pricing: Joi.object({
    free: Joi.boolean().default(true),
    price: Joi.number().min(0).when('free', { is: false, then: Joi.required() }),
    currency: Joi.string().valid('USD', 'ETH').default('USD'),
    discountPercentage: Joi.number().min(0).max(100).optional(),
    validUntil: Joi.date().iso().optional()
  }).optional(),
  
  settings: Joi.object({
    allowDownload: Joi.boolean().default(false),
    allowSharing: Joi.boolean().default(true),
    maxShares: Joi.number().min(1).max(100).optional(),
    watermark: Joi.boolean().default(true),
    analytics: Joi.boolean().default(true),
    comments: Joi.boolean().default(true),
    ratings: Joi.boolean().default(true),
    autoplay: Joi.boolean().default(false),
    loop: Joi.boolean().default(false)
  }).optional(),
  
  scheduledPublish: Joi.date().iso().min('now').optional(),
  expiresAt: Joi.date().iso().optional()
});

/**
 * Content update validation schema
 */
const updateContentSchema = createContentSchema.fork(
  ['title', 'description', 'type', 'category'],
  (schema) => schema.optional()
);

/**
 * Content sharing validation schema
 */
const shareContentSchema = Joi.object({
  recipients: Joi.array().items(
    Joi.object({
      email: Joi.string().email().required(),
      accessDuration: Joi.number().min(1).max(365).default(7), // days
      message: Joi.string().trim().max(500).optional()
    })
  ).min(1).max(50).required(),
  
  shareType: Joi.string().valid('view_only', 'download', 'stream').default('view_only'),
  expiresIn: Joi.number().min(1).max(365).default(30), // days
  maxViews: Joi.number().min(1).max(1000).optional(),
  requireLogin: Joi.boolean().default(true),
  trackViews: Joi.boolean().default(true)
});

/**
 * Streaming validation schema
 */
const streamingSchema = Joi.object({
  quality: Joi.string().valid('360p', '480p', '720p', '1080p').default('720p'),
  startTime: Joi.number().min(0).default(0),
  endTime: Joi.number().min(0).optional(),
  subtitles: Joi.boolean().default(false),
  language: Joi.string().length(2).default('en')
});

// =============================================================================
// RATE LIMITING
// =============================================================================

/**
 * General content access rate limiting
 */
const contentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: 'Too many content requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 200,
      remaining: 0,
      resetTime: Date.now() + (15 * 60 * 1000)
    });
  }
});

/**
 * Content upload rate limiting
 */
const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'Too many upload attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 20,
      remaining: 0,
      resetTime: Date.now() + (60 * 60 * 1000)
    });
  }
});

/**
 * Streaming rate limiting
 */
const streamingRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50,
  message: 'Too many streaming requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ResponseFormatter.formatRateLimitError(res, {
      limit: 50,
      remaining: 0,
      resetTime: Date.now() + (5 * 60 * 1000)
    });
  }
});

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

/**
 * GET /content - List available content (filtered by access)
 */
router.get('/',
  contentRateLimit,
  validationMiddleware.validateQuery(contentQuerySchema),
  cacheMiddleware(300), // 5 minutes cache
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const {
        page,
        limit,
        sort,
        order,
        type,
        category,
        artist,
        event,
        accessLevel,
        search,
        tags,
        minDuration,
        maxDuration,
        hasSubtitles,
        quality
      } = req.query;

      const filters = {
        ...(type && { type }),
        ...(category && { category }),
        ...(artist && { artist }),
        ...(event && { event }),
        ...(accessLevel && { accessLevel }),
        ...(search && { search }),
        ...(tags && { tags }),
        ...(minDuration && { minDuration }),
        ...(maxDuration && { maxDuration }),
        ...(hasSubtitles !== undefined && { hasSubtitles }),
        ...(quality && { quality })
      };

      const result = await contentController.getContent({
        filters,
        pagination: { page, limit },
        sort: { field: sort, order },
        userId // For access control
      });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Content retrieved successfully',
        {
          filters,
          sort: { field: sort, order }
        }
      );

    } catch (error) {
      logger.error('Error listing content', {
        error: error.message,
        query: req.query,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /content/exclusive - Get exclusive content by ticket
 */
router.get('/exclusive',
  contentRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateQuery(contentQuerySchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { page, limit, sort, order, event } = req.query;

      // Get user's tickets to determine access
      const userTickets = await ticketController.getUserActiveTickets(userId);
      
      if (!userTickets || userTickets.length === 0) {
        return ResponseFormatter.formatSuccess(
          res,
          [],
          'No exclusive content available',
          { hasTickets: false }
        );
      }

      const result = await contentController.getExclusiveContent({
        userId,
        tickets: userTickets,
        filters: { ...(event && { event }) },
        pagination: { page, limit },
        sort: { field: sort, order }
      });

      return ResponseFormatter.formatPaginated(
        res,
        result.data,
        page,
        limit,
        result.total,
        'Exclusive content retrieved successfully',
        {
          accessibleEvents: userTickets.map(t => t.eventId),
          ticketCount: userTickets.length
        }
      );

    } catch (error) {
      logger.error('Error getting exclusive content', {
        error: error.message,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /content/:id - Get single content item
 */
router.get('/:id',
  contentRateLimit,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user?.id;

      const content = await contentController.getContentById(id, userId);

      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      // Check access permissions
      const hasAccess = await contentController.checkAccess(content, userId);
      
      if (!hasAccess.allowed) {
        return ResponseFormatter.formatForbidden(res, hasAccess.reason || 'Access denied to this content');
      }

      // Log content view for analytics
      if (userId) {
        logBusinessEvent('content_viewed', {
          contentId: id,
          userId,
          contentType: content.type,
          accessLevel: content.accessLevel,
          eventId: content.eventId
        }, { correlationId: req.correlationId });

        // Track view in analytics
        await analyticsController.trackContentView(id, userId, {
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          referer: req.get('Referer')
        });
      }

      return ResponseFormatter.formatSuccess(
        res,
        {
          ...content,
          accessInfo: hasAccess
        },
        'Content retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting content details', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /content/:id/stream - Stream content (token-gated)
 */
router.get('/:id/stream',
  streamingRateLimit,
  authMiddleware.requireAuth,
  nftGateMiddleware.checkNFTAccess,
  validationMiddleware.validateQuery(streamingSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { quality, startTime, endTime, subtitles, language } = req.query;

      const content = await contentController.getContentById(id, userId);

      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      if (!['video', 'audio', 'livestream'].includes(content.type)) {
        return ResponseFormatter.formatError(res, 'Content type not streamable', 400);
      }

      // Additional access check for streaming
      const hasAccess = await contentController.checkStreamingAccess(content, userId);
      
      if (!hasAccess.allowed) {
        return ResponseFormatter.formatForbidden(res, hasAccess.reason);
      }

      const streamingOptions = {
        quality,
        startTime,
        endTime,
        subtitles,
        language,
        watermark: content.settings.watermark,
        analytics: content.settings.analytics
      };

      const stream = await streamingController.createStream(content, streamingOptions);

      // Log streaming event
      logBusinessEvent('content_streamed', {
        contentId: id,
        userId,
        quality,
        duration: endTime ? endTime - startTime : content.metadata.duration,
        streamId: stream.id
      }, { correlationId: req.correlationId });

      // Set appropriate headers for streaming
      res.setHeader('Content-Type', stream.mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');
      
      return stream.pipe(res);

    } catch (error) {
      logger.error('Error streaming content', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        streamingOptions: req.query,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /content/:id/download - Download content (token-gated)
 */
router.post('/:id/download',
  contentRateLimit,
  authMiddleware.requireAuth,
  nftGateMiddleware.checkNFTAccess,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const content = await contentController.getContentById(id, userId);

      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      if (!content.settings.allowDownload) {
        return ResponseFormatter.formatForbidden(res, 'Downloads are not allowed for this content');
      }

      // Check download access
      const hasAccess = await contentController.checkDownloadAccess(content, userId);
      
      if (!hasAccess.allowed) {
        return ResponseFormatter.formatForbidden(res, hasAccess.reason);
      }

      const download = await contentController.createDownload(content, userId);

      // Log download event
      logBusinessEvent('content_downloaded', {
        contentId: id,
        userId,
        contentType: content.type,
        fileSize: content.metadata.fileSize,
        downloadId: download.id
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        {
          downloadUrl: download.url,
          expiresAt: download.expiresAt,
          downloadId: download.id,
          filename: download.filename
        },
        'Download link generated successfully'
      );

    } catch (error) {
      logger.error('Error generating download', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /content - Upload content (artist/admin only)
 */
router.post('/',
  uploadRateLimit,
  authMiddleware.requireAuth,
  permissionMiddleware.requireAnyPermission([
    PERMISSIONS.CREATE_EVENTS,
    PERMISSIONS.MANAGE_EVENTS,
    PERMISSIONS.MODERATE_CONTENT
  ]),
  upload.array('files', 5),
  validationMiddleware.validateBody(createContentSchema),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const files = req.files;
      
      if (!files || files.length === 0) {
        return ResponseFormatter.formatError(res, 'At least one file is required', 400);
      }

      const contentData = {
        ...req.body,
        createdBy: userId,
        files: files.map(file => ({
          originalName: file.originalname,
          filename: file.filename,
          path: file.path,
          size: file.size,
          mimeType: file.mimetype
        }))
      };

      const content = await contentController.createContent(contentData);

      // Log content creation
      logBusinessEvent('content_created', {
        contentId: content.id,
        userId,
        contentType: content.type,
        accessLevel: content.accessLevel,
        filesCount: files.length
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        content,
        'Content uploaded successfully'
      );

    } catch (error) {
      logger.error('Error uploading content', {
        error: error.message,
        userId: req.user?.id,
        contentData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * PUT /content/:id - Update content (artist/admin only)
 */
router.put('/:id',
  contentRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(updateContentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const content = await contentController.getContentById(id);
      
      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      // Check if user can edit this content
      if (content.createdBy.toString() !== userId && 
          !permissionMiddleware.hasPermission(req.user.role, PERMISSIONS.MANAGE_EVENTS)) {
        return ResponseFormatter.formatForbidden(res, 'You can only edit your own content');
      }

      const updatedContent = await contentController.updateContent(id, req.body);

      // Log content update
      logBusinessEvent('content_updated', {
        contentId: id,
        userId,
        changes: Object.keys(req.body)
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatSuccess(
        res,
        updatedContent,
        'Content updated successfully'
      );

    } catch (error) {
      logger.error('Error updating content', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        updateData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * DELETE /content/:id - Remove content (admin only)
 */
router.delete('/:id',
  contentRateLimit,
  authMiddleware.requireAuth,
  permissionMiddleware.requirePermission(PERMISSIONS.MANAGE_EVENTS),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const content = await contentController.getContentById(id);
      
      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      await contentController.deleteContent(id, userId);

      // Log content deletion
      logBusinessEvent('content_deleted', {
        contentId: id,
        contentTitle: content.title,
        deletedBy: userId
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatNoContent(res, 'Content deleted successfully');

    } catch (error) {
      logger.error('Error deleting content', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * GET /content/:id/analytics - Get content analytics
 */
router.get('/:id/analytics',
  contentRateLimit,
  authMiddleware.requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { timeframe = '30d', metrics = 'all' } = req.query;

      const content = await contentController.getContentById(id);
      
      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      // Check if user can view analytics
      if (content.createdBy.toString() !== userId && 
          !permissionMiddleware.hasPermission(req.user.role, PERMISSIONS.VIEW_ANALYTICS)) {
        return ResponseFormatter.formatForbidden(res, 'Access denied to analytics');
      }

      const analytics = await analyticsController.getContentAnalytics(id, {
        timeframe,
        metrics: metrics.split(','),
        userId
      });

      return ResponseFormatter.formatSuccess(
        res,
        analytics,
        'Analytics retrieved successfully'
      );

    } catch (error) {
      logger.error('Error getting content analytics', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

/**
 * POST /content/:id/share - Share content with restrictions
 */
router.post('/:id/share',
  contentRateLimit,
  authMiddleware.requireAuth,
  validationMiddleware.validateBody(shareContentSchema),
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const shareData = { ...req.body, sharedBy: userId };

      const content = await contentController.getContentById(id, userId);
      
      if (!content) {
        return ResponseFormatter.formatNotFound(res, 'Content');
      }

      if (!content.settings.allowSharing) {
        return ResponseFormatter.formatForbidden(res, 'Sharing is not allowed for this content');
      }

      // Check if user has access to share this content
      const hasAccess = await contentController.checkAccess(content, userId);
      
      if (!hasAccess.allowed) {
        return ResponseFormatter.formatForbidden(res, 'You cannot share content you do not have access to');
      }

      const shareLinks = await contentController.createShareLinks(id, shareData);

      // Log sharing event
      logBusinessEvent('content_shared', {
        contentId: id,
        userId,
        recipientCount: req.body.recipients.length,
        shareType: req.body.shareType,
        shareIds: shareLinks.map(s => s.id)
      }, { correlationId: req.correlationId });

      return ResponseFormatter.formatCreated(
        res,
        shareLinks,
        'Content shared successfully'
      );

    } catch (error) {
      logger.error('Error sharing content', {
        error: error.message,
        contentId: req.params.id,
        userId: req.user?.id,
        shareData: req.body,
        correlationId: req.correlationId
      });

      return ResponseFormatter.formatError(res, error);
    }
  }
);

// =============================================================================
// ERROR HANDLING MIDDLEWARE
// =============================================================================

/**
 * Handle multer upload errors
 */
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return ResponseFormatter.formatError(res, 'File too large', 413);
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return ResponseFormatter.formatError(res, 'Too many files', 400);
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return ResponseFormatter.formatError(res, 'Unexpected file field', 400);
    }
  }
  
  next(error);
});

/**
 * Handle 404 errors for unmatched routes
 */
router.use('*', (req, res) => {
  ResponseFormatter.formatNotFound(res, 'Route');
});

/**
 * Handle errors in content routes
 */
router.use((error, req, res, next) => {
  logger.error('Content route error', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    correlationId: req.correlationId
  });

  if (error.name === 'ValidationError') {
    return ResponseFormatter.formatValidationError(res, error);
  }

  if (error.name === 'CastError') {
    return ResponseFormatter.formatError(res, 'Invalid content ID format', 400);
  }

  if (error.name === 'StreamingError') {
    return ResponseFormatter.formatError(res, 'Content streaming failed', 503);
  }

  if (error.name === 'AccessDeniedError') {
    return ResponseFormatter.formatForbidden(res, error.message);
  }

  return ResponseFormatter.formatError(res, error);
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = router;
