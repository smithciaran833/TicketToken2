// controllers/contentController.js - Content management with NFT access control

const { v4: uuidv4 } = require('uuid');
const ExclusiveContent = require('../models/ExclusiveContent');
const NFTAccess = require('../models/NFTAccess');
const NFTOwnership = require('../models/NFTOwnership');
const AccessGrant = require('../models/AccessGrant');
const nftAccessService = require('../services/nftAccessService');
const { validateUrl } = require('../utils/validators');

// @desc    Create new exclusive content
// @route   POST /api/content
// @access  Private (Artists and Admins only)
const createContent = async (req, res) => {
  try {
    const {
      title,
      description,
      contentType,
      event,
      contentUrl,
      thumbnailUrl,
      accessControl,
      availableFrom,
      availableUntil,
      metadata,
      status,
      nftRules // Optional array of NFT access rules
    } = req.body;

    // Validate required fields
    if (!title || !description || !contentType || !event || !contentUrl) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        errors: {
          title: !title ? 'Title is required' : undefined,
          description: !description ? 'Description is required' : undefined,
          contentType: !contentType ? 'Content type is required' : undefined,
          event: !event ? 'Event is required' : undefined,
          contentUrl: !contentUrl ? 'Content URL is required' : undefined
        }
      });
    }

    // Validate URLs
    if (!validateUrl(contentUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content URL',
        errors: { contentUrl: 'Must be a valid URL' }
      });
    }

    if (thumbnailUrl && !validateUrl(thumbnailUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid thumbnail URL',
        errors: { thumbnailUrl: 'Must be a valid URL' }
      });
    }

    // Generate unique content ID
    const contentId = uuidv4();

    // Create content
    const content = await ExclusiveContent.create({
      contentId,
      title,
      description,
      contentType,
      artist: req.user._id, // Artist is the logged-in user
      event,
      contentUrl,
      thumbnailUrl,
      accessControl: {
        type: accessControl?.type || 'nft-based',
        ticketTypes: accessControl?.ticketTypes || [],
        defaultAccessLevel: accessControl?.defaultAccessLevel || 'view'
      },
      availableFrom: availableFrom || new Date(),
      availableUntil: availableUntil || null,
      metadata: metadata || {},
      status: status || 'draft'
    });

    // If NFT rules were provided, create them
    if (nftRules && Array.isArray(nftRules) && nftRules.length > 0) {
      await nftAccessService.defineAccessRules(
        content._id,
        'ExclusiveContent',
        nftRules,
        req.user._id
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Content created successfully',
      data: content
    });
  } catch (error) {
    console.error('Create content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create content',
      errors: { server: 'Server error creating content' }
    });
  }
};

// @desc    Get exclusive content by ID
// @route   GET /api/content/:id
// @access  Private (Access controlled by NFT ownership)
const getContentById = async (req, res) => {
  try {
    const content = await ExclusiveContent.findOne({ contentId: req.params.id })
      .populate('artist', 'displayName username profileImage')
      .populate('event', 'title startDate');

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        errors: { content: 'The requested content does not exist' }
      });
    }

    // Check content availability window
    if (!content.isAvailable()) {
      // Creator or admin can always access
      if (content.artist._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Content not available',
          errors: { content: 'This content is not currently available' }
        });
      }
    }

    // If content is public, return it
    if (content.accessControl.type === 'public') {
      return res.json({
        success: true,
        message: 'Content retrieved successfully',
        data: content
      });
    }

    // If user is creator or admin, return content
    if (content.artist._id.toString() === req.user._id.toString() || req.user.role === 'admin') {
      return res.json({
        success: true,
        message: 'Content retrieved successfully',
        data: content
      });
    }

    // Check NFT-based access if required
    if (content.requiresNFT()) {
      // Check access using NFT service
      const accessResult = await nftAccessService.checkAccess(
        req.user._id,
        content._id,
        'ExclusiveContent',
        'view'
      );

      if (accessResult.hasAccess) {
        // Generate access grant
        const accessGrant = await nftAccessService.generateAccessGrant(
          req.user._id,
          {
            id: content._id,
            model: 'ExclusiveContent',
            title: content.title,
            type: content.contentType,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
          },
          {
            address: accessResult.accessRules[0].accessRule.nftAddress,
            walletAddress: req.user.walletAddresses.find(w => w.isPrimary)?.address
          },
          'view'
        );

        // Include access token in response
        return res.json({
          success: true,
          message: 'Content retrieved successfully',
          data: {
            ...content.toObject(),
            accessToken: accessGrant.token,
            accessExpiresAt: accessGrant.expiresAt
          }
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          errors: { nft: accessResult.reason },
          requiredNFTs: accessResult.missingNFTs
        });
      }
    }

    // Check ticket-based access if applicable
    if (content.accessControl.type === 'ticket-based' || content.accessControl.type === 'hybrid') {
      // This would check if the user has any tickets that grant access
      // For now, we'll just return an error
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: { ticket: 'Ticket-based access not implemented yet' }
      });
    }

    // No access method succeeded
    return res.status(403).json({
      success: false,
      message: 'Access denied',
      errors: { access: 'You do not have the required access' }
    });
  } catch (error) {
    console.error('Get content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve content',
      errors: { server: 'Server error retrieving content' }
    });
  }
};

// @desc    Get all content for an event
// @route   GET /api/content/event/:eventId
// @access  Private
const getContentByEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Find all published content for the event
    const allContent = await ExclusiveContent.find({
      event: eventId,
      status: 'published',
      availableFrom: { $lte: new Date() },
      $or: [
        { availableUntil: { $exists: false } },
        { availableUntil: { $gt: new Date() } }
      ]
    })
    .populate('artist', 'displayName username profileImage')
    .sort({ createdAt: -1 });

    if (!allContent.length) {
      return res.json({
        success: true,
        message: 'No content found for this event',
        data: { count: 0, content: [] }
      });
    }

    // If user is admin, return all content
    if (req.user.role === 'admin') {
      return res.json({
        success: true,
        message: 'Event content retrieved successfully',
        data: { count: allContent.length, content: allContent }
      });
    }

    // For artists, return all their content plus content they have access to
    const isArtist = allContent.some(c => c.artist._id.toString() === req.user._id.toString());
    
    if (isArtist) {
      // Split into own content and other content
      const ownContent = allContent.filter(c => c.artist._id.toString() === req.user._id.toString());
      const otherContent = allContent.filter(c => c.artist._id.toString() !== req.user._id.toString());
      
      // For other content, check access
      const accessibleContent = [];
      
      for (const content of otherContent) {
        // Public content is always accessible
        if (content.accessControl.type === 'public') {
          accessibleContent.push(content);
          continue;
        }
        
        // Check NFT-based access
        if (content.requiresNFT()) {
          const accessResult = await nftAccessService.checkAccess(
            req.user._id,
            content._id,
            'ExclusiveContent',
            'view'
          );
          
          if (accessResult.hasAccess) {
            accessibleContent.push(content);
          }
        }
        
        // Check ticket-based access if applicable
        // Not implemented yet
      }
      
      return res.json({
        success: true,
        message: 'Event content retrieved successfully',
        data: { 
          count: ownContent.length + accessibleContent.length,
          ownContent: ownContent,
          accessibleContent: accessibleContent
        }
      });
    }

    // For regular users, filter based on access control
    const accessibleContent = [];
    
    // Process each content item
    for (const content of allContent) {
      // Public content is always accessible
      if (content.accessControl.type === 'public') {
        accessibleContent.push(content);
        continue;
      }
      
      // Check NFT-based access
      if (content.requiresNFT()) {
        const accessResult = await nftAccessService.checkAccess(
          req.user._id,
          content._id,
          'ExclusiveContent',
          'view'
        );
        
        if (accessResult.hasAccess) {
          accessibleContent.push({
            ...content.toObject(),
            accessReason: 'NFT ownership'
          });
        }
      }
      
      // Check ticket-based access if applicable
      // Not implemented yet
    }

    return res.json({
      success: true,
      message: 'Event content retrieved successfully',
      data: { 
        count: accessibleContent.length,
        content: accessibleContent
      }
    });
  } catch (error) {
    console.error('Get event content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve event content',
      errors: { server: 'Server error retrieving event content' }
    });
  }
};

// @desc    Get all content by an artist
// @route   GET /api/content/artist/:artistId
// @access  Private
const getContentByArtist = async (req, res) => {
  try {
    const { artistId } = req.params;
    
    // Query parameters for pagination and filtering
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const contentType = req.query.type;
    
    // If viewing own content or is admin, show all including drafts
    const isOwnContent = artistId === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    const showAll = isOwnContent || isAdmin;
    
    // Build query
    const query = { artist: artistId };
    
    // Add filters
    if (contentType) query.contentType = contentType;
    if (!showAll) {
      query.status = 'published';
      query.availableFrom = { $lte: new Date() };
      query.$or = [
        { availableUntil: { $exists: false } },
        { availableUntil: { $gt: new Date() } }
      ];
    }
    
    // Count total documents
    const total = await ExclusiveContent.countDocuments(query);
    
    // Get content with pagination
    const content = await ExclusiveContent.find(query)
      .populate('event', 'title startDate')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    // If viewing own content or admin, return all
    if (showAll) {
      return res.json({
        success: true,
        message: 'Artist content retrieved successfully',
        data: {
          content,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1
          }
        }
      });
    }
    
    // For other users, filter based on access control
    const accessibleContent = [];
    
    // Process each content item
    for (const item of content) {
      // Public content is always accessible
      if (item.accessControl.type === 'public') {
        accessibleContent.push(item);
        continue;
      }
      
      // Check NFT-based access
      if (item.requiresNFT()) {
        const accessResult = await nftAccessService.checkAccess(
          req.user._id,
          item._id,
          'ExclusiveContent',
          'view'
        );
        
        if (accessResult.hasAccess) {
          accessibleContent.push(item);
        }
      }
      
      // Check ticket-based access if applicable
      // Not implemented yet
    }
    
    return res.json({
      success: true,
      message: 'Artist content retrieved successfully',
      data: {
        content: accessibleContent,
        pagination: {
          page,
          limit,
          total: accessibleContent.length,
          totalPages: Math.ceil(accessibleContent.length / limit),
          hasNext: page < Math.ceil(accessibleContent.length / limit),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error('Get artist content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve artist content',
      errors: { server: 'Server error retrieving artist content' }
    });
  }
};

// @desc    Update exclusive content
// @route   PUT /api/content/:id
// @access  Private (Artists and Admins only)
const updateContent = async (req, res) => {
  try {
    const contentId = req.params.id;
    const content = await ExclusiveContent.findOne({ contentId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        errors: { content: 'The requested content does not exist' }
      });
    }

    // Check if user is authorized to update (artist or admin)
    if (content.artist.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: { permission: 'You can only update your own content' }
      });
    }

    const {
      title,
      description,
      contentType,
      contentUrl,
      thumbnailUrl,
      accessControl,
      availableFrom,
      availableUntil,
      metadata,
      status,
      nftRules
    } = req.body;

    // Validate URLs if provided
    if (contentUrl && !validateUrl(contentUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid content URL',
        errors: { contentUrl: 'Must be a valid URL' }
      });
    }

    if (thumbnailUrl && !validateUrl(thumbnailUrl)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid thumbnail URL',
        errors: { thumbnailUrl: 'Must be a valid URL' }
      });
    }

    // Update fields if provided
    if (title !== undefined) content.title = title;
    if (description !== undefined) content.description = description;
    if (contentType !== undefined) content.contentType = contentType;
    if (contentUrl !== undefined) content.contentUrl = contentUrl;
    if (thumbnailUrl !== undefined) content.thumbnailUrl = thumbnailUrl;
    if (accessControl !== undefined) {
      content.accessControl = {
        ...content.accessControl,
        ...accessControl
      };
    }
    if (availableFrom !== undefined) content.availableFrom = availableFrom;
    if (availableUntil !== undefined) content.availableUntil = availableUntil;
    if (metadata !== undefined) content.metadata = metadata;
    if (status !== undefined) {
      content.status = status;
      if (status === 'published' && !content.publishedAt) {
        content.publishedAt = new Date();
      }
    }

    // Save updated content
    await content.save();

    // Update NFT access rules if provided
    if (nftRules && Array.isArray(nftRules)) {
      await nftAccessService.defineAccessRules(
        content._id,
        'ExclusiveContent',
        nftRules,
        req.user._id
      );
    }

    return res.json({
      success: true,
      message: 'Content updated successfully',
      data: content
    });
  } catch (error) {
    console.error('Update content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update content',
      errors: { server: 'Server error updating content' }
    });
  }
};

// @desc    Delete exclusive content
// @route   DELETE /api/content/:id
// @access  Private (Artists and Admins only)
const deleteContent = async (req, res) => {
  try {
    const contentId = req.params.id;
    const content = await ExclusiveContent.findOne({ contentId });

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        errors: { content: 'The requested content does not exist' }
      });
    }

    // Check if user is authorized to delete (artist or admin)
    if (content.artist.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: { permission: 'You can only delete your own content' }
      });
    }

    // Delete NFT access rules for this content
    await NFTAccess.deleteMany({
      resourceId: content._id,
      resourceModel: 'ExclusiveContent'
    });

    // Delete any access grants for this content
    await AccessGrant.deleteMany({
      'resource.id': content._id,
      'resource.model': 'ExclusiveContent'
    });

    // Delete the content
    await content.deleteOne();

    return res.json({
      success: true,
      message: 'Content deleted successfully',
      data: { contentId }
    });
  } catch (error) {
    console.error('Delete content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete content',
      errors: { server: 'Server error deleting content' }
    });
  }
};

// @desc    Get NFT-accessible content for user
// @route   GET /api/content/nft-accessible
// @access  Private
const getNFTAccessibleContent = async (req, res) => {
  try {
    // Get accessible resources using the NFT access service
    const accessibleResources = await nftAccessService.getAccessibleResources(req.user._id);

    // Filter for content resources only
    const contentResources = accessibleResources.resources.filter(r => r.model === 'ExclusiveContent');

    // Get detailed content info
    const contentIds = contentResources.map(r => r.resource._id);
    const content = await ExclusiveContent.find({
      _id: { $in: contentIds },
      status: 'published'
    })
    .populate('artist', 'displayName username profileImage')
    .populate('event', 'title startDate');

    return res.json({
      success: true,
      message: 'NFT-accessible content retrieved successfully',
      data: {
        count: content.length,
        content
      }
    });
  } catch (error) {
    console.error('Get NFT-accessible content error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve NFT-accessible content',
      errors: { server: 'Server error retrieving content' }
    });
  }
};

// @desc    Check access to content
// @route   GET /api/content/:id/check-access
// @access  Private
const checkContentAccess = async (req, res) => {
  try {
    const { id } = req.params;
    
    const content = await ExclusiveContent.findOne({ contentId: id });
    
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found',
        errors: { content: 'The requested content does not exist' }
      });
    }
    
    // Default to no access
    let hasAccess = false;
    let accessMethod = null;
    let accessDetails = null;
    
    // Check if content is available
    if (!content.isAvailable() && req.user.role !== 'admin' && content.artist.toString() !== req.user._id.toString()) {
      return res.json({
        success: true,
        message: 'Content not available',
        data: {
          hasAccess: false,
          reason: 'Content is not currently available',
          content: {
            contentId: content.contentId,
            title: content.title,
            contentType: content.contentType
          }
        }
      });
    }
    
    // If user is artist or admin, they always have access
    if (content.artist.toString() === req.user._id.toString() || req.user.role === 'admin') {
      hasAccess = true;
      accessMethod = 'owner';
      accessDetails = { role: req.user.role === 'admin' ? 'admin' : 'creator' };
    }
    // If content is public, user has access
    else if (content.accessControl.type === 'public') {
      hasAccess = true;
      accessMethod = 'public';
      accessDetails = { accessLevel: 'view' };
    }
    // Check NFT-based access
    else if (content.requiresNFT()) {
      const accessResult = await nftAccessService.checkAccess(
        req.user._id,
        content._id,
        'ExclusiveContent',
        'view'
      );
      
      if (accessResult.hasAccess) {
        hasAccess = true;
        accessMethod = 'nft';
        accessDetails = {
          accessRules: accessResult.accessRules,
          accessLevel: accessResult.accessRules[0].accessRule.accessLevel
        };
      }
    }
    // Check ticket-based access
    else if (content.accessControl.type === 'ticket-based' || content.accessControl.type === 'hybrid') {
      // Not implemented yet
      accessMethod = 'ticket';
      accessDetails = { implemented: false };
    }
    
    return res.json({
      success: true,
      message: hasAccess ? 'Access granted' : 'Access denied',
      data: {
        hasAccess,
        accessMethod,
        accessDetails,
        content: {
          contentId: content.contentId,
          title: content.title,
          contentType: content.contentType,
          accessControl: content.accessControl
        }
      }
    });
  } catch (error) {
    console.error('Check content access error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to check content access',
      errors: { server: 'Server error checking content access' }
    });
  }
};

module.exports = {
  createContent,
  getContentById,
  getContentByEvent,
  getContentByArtist,
  updateContent,
  deleteContent,
  getNFTAccessibleContent,
  checkContentAccess
};
