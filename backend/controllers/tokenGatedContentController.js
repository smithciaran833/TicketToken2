const TokenGatedContent = require('../models/tokenGatedContent');
const { verifyTokenOwnership } = require('../services/tokenVerificationService');

/**
 * Create new token-gated content
 * @route POST /api/token-gated-content
 */
const createContent = async (req, res) => {
  try {
    const {
      title,
      description,
      contentType,
      content,
      requiredTokens,
      accessControl,
      expiresAt,
      metadata
    } = req.body;

    // Validate required fields
    if (!title || !description || !contentType || !content || !requiredTokens || requiredTokens.length === 0) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create the content
    const newContent = new TokenGatedContent({
      title,
      description,
      contentType,
      content,
      requiredTokens,
      accessControl: accessControl || 'anyToken',
      createdBy: req.user._id,
      expiresAt: expiresAt || null,
      metadata: metadata || {}
    });

    await newContent.save();

    return res.status(201).json({
      message: 'Token-gated content created successfully',
      content: {
        id: newContent._id,
        title: newContent.title,
        description: newContent.description,
        contentType: newContent.contentType,
        requiredTokens: newContent.requiredTokens,
        accessControl: newContent.accessControl,
        createdAt: newContent.createdAt,
        expiresAt: newContent.expiresAt
      }
    });
  } catch (error) {
    console.error('Error creating token-gated content:', error);
    return res.status(500).json({ error: 'Error creating token-gated content' });
  }
};

/**
 * Get all token-gated content (with metadata only, no actual content)
 * @route GET /api/token-gated-content
 */
const getAllContent = async (req, res) => {
  try {
    const { page = 1, limit = 10, createdBy } = req.query;
    
    const query = { isActive: true };
    
    // Filter by creator if specified
    if (createdBy) {
      query.createdBy = createdBy;
    }
    
    // Get content without the actual content field to reduce payload size
    const contents = await TokenGatedContent.find(query)
      .select('-content')
      .populate('createdBy', 'username email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    // Get total count
    const totalCount = await TokenGatedContent.countDocuments(query);
    
    return res.status(200).json({
      contents,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: parseInt(page),
      totalCount
    });
  } catch (error) {
    console.error('Error getting token-gated content:', error);
    return res.status(500).json({ error: 'Error getting token-gated content' });
  }
};

/**
 * Get single token-gated content by ID with access check
 * @route GET /api/token-gated-content/:id
 */
const getContentById = async (req, res) => {
  try {
    // Content is already checked and provided by middleware
    const content = req.content;
    
    // Return the full content including the actual content field
    return res.status(200).json({ content });
  } catch (error) {
    console.error('Error getting token-gated content:', error);
    return res.status(500).json({ error: 'Error getting token-gated content' });
  }
};

/**
 * Check if user has access to content without retrieving the content
 * @route GET /api/token-gated-content/:id/check-access
 */
const checkContentAccess = async (req, res) => {
  try {
    const contentId = req.params.id;
    const user = req.user;
    
    // Get the content metadata
    const content = await TokenGatedContent.findById(contentId).select('-content');
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Check if content has expired
    if (content.expiresAt && new Date(content.expiresAt) < new Date()) {
      return res.status(200).json({ 
        hasAccess: false, 
        reason: 'expired',
        requiredTokens: content.requiredTokens
      });
    }
    
    // Check if content is active
    if (!content.isActive) {
      return res.status(200).json({ 
        hasAccess: false, 
        reason: 'inactive',
        requiredTokens: content.requiredTokens
      });
    }
    
    // Content creator always has access
    if (content.createdBy.toString() === user._id.toString()) {
      return res.status(200).json({ 
        hasAccess: true, 
        reason: 'creator'
      });
    }
    
    // Get user's wallet addresses
    const walletAddresses = user.wallets || [];
    
    if (walletAddresses.length === 0) {
      return res.status(200).json({ 
        hasAccess: false, 
        reason: 'noWallets',
        requiredTokens: content.requiredTokens
      });
    }
    
    // Check if user has the required tokens
    let hasAccess = false;
    let tokensOwned = [];
    
    if (content.accessControl === 'anyToken') {
      // User needs to own at least one of any required tokens
      for (const requiredToken of content.requiredTokens) {
        for (const walletAddress of walletAddresses) {
          const ownsToken = await verifyTokenOwnership(
            walletAddress,
            requiredToken.contractAddress,
            requiredToken.tokenId,
            requiredToken.minAmount
          );
          
          if (ownsToken) {
            hasAccess = true;
            tokensOwned.push({
              contractAddress: requiredToken.contractAddress,
              tokenId: requiredToken.tokenId
            });
            break;
          }
        }
        
        if (hasAccess) break;
      }
    } else if (content.accessControl === 'allTokens') {
      // User needs to own all required tokens
      hasAccess = true;
      
      for (const requiredToken of content.requiredTokens) {
        let ownsThisToken = false;
        
        for (const walletAddress of walletAddresses) {
          const ownsToken = await verifyTokenOwnership(
            walletAddress,
            requiredToken.contractAddress,
            requiredToken.tokenId,
            requiredToken.minAmount
          );
          
          if (ownsToken) {
            ownsThisToken = true;
            tokensOwned.push({
              contractAddress: requiredToken.contractAddress,
              tokenId: requiredToken.tokenId
            });
            break;
          }
        }
        
        if (!ownsThisToken) {
          hasAccess = false;
          break;
        }
      }
    } else if (content.accessControl === 'specificToken') {
      // User needs to own the specific token(s)
      hasAccess = true;
      
      for (const requiredToken of content.requiredTokens) {
        if (!requiredToken.tokenId) {
          continue; // Skip if no specific tokenId is required
        }
        
        let ownsThisToken = false;
        
        for (const walletAddress of walletAddresses) {
          const ownsToken = await verifyTokenOwnership(
            walletAddress,
            requiredToken.contractAddress,
            requiredToken.tokenId,
            requiredToken.minAmount
          );
          
          if (ownsToken) {
            ownsThisToken = true;
            tokensOwned.push({
              contractAddress: requiredToken.contractAddress,
              tokenId: requiredToken.tokenId
            });
            break;
          }
        }
        
        if (!ownsThisToken) {
          hasAccess = false;
          break;
        }
      }
    }
    
    return res.status(200).json({ 
      hasAccess, 
      reason: hasAccess ? 'tokenOwner' : 'insufficientTokens',
      tokensOwned,
      requiredTokens: content.requiredTokens
    });
  } catch (error) {
    console.error('Error checking content access:', error);
    return res.status(500).json({ error: 'Error checking content access' });
  }
};

/**
 * Update token-gated content
 * @route PUT /api/token-gated-content/:id
 */
const updateContent = async (req, res) => {
  try {
    const contentId = req.params.id;
    const user = req.user;
    
    // Get the content
    const content = await TokenGatedContent.findById(contentId);
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Only the creator can update content
    if (content.createdBy.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'You are not authorized to update this content' });
    }
    
    const {
      title,
      description,
      contentType,
      content: contentBody,
      requiredTokens,
      accessControl,
      isActive,
      expiresAt,
      metadata
    } = req.body;
    
    // Update fields if provided
    if (title) content.title = title;
    if (description) content.description = description;
    if (contentType) content.contentType = contentType;
    if (contentBody) content.content = contentBody;
    if (requiredTokens) content.requiredTokens = requiredTokens;
    if (accessControl) content.accessControl = accessControl;
    if (isActive !== undefined) content.isActive = isActive;
    if (expiresAt !== undefined) content.expiresAt = expiresAt;
    if (metadata) content.metadata = metadata;
    
    await content.save();
    
    return res.status(200).json({
      message: 'Token-gated content updated successfully',
      content: {
        id: content._id,
        title: content.title,
        description: content.description,
        contentType: content.contentType,
        requiredTokens: content.requiredTokens,
        accessControl: content.accessControl,
        isActive: content.isActive,
        createdAt: content.createdAt,
        updatedAt: content.updatedAt,
        expiresAt: content.expiresAt
      }
    });
  } catch (error) {
    console.error('Error updating token-gated content:', error);
    return res.status(500).json({ error: 'Error updating token-gated content' });
  }
};

/**
 * Delete token-gated content
 * @route DELETE /api/token-gated-content/:id
 */
const deleteContent = async (req, res) => {
  try {
    const contentId = req.params.id;
    const user = req.user;
    
    // Get the content
    const content = await TokenGatedContent.findById(contentId);
    
    if (!content) {
      return res.status(404).json({ error: 'Content not found' });
    }
    
    // Only the creator can delete content
    if (content.createdBy.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'You are not authorized to delete this content' });
    }
    
    await TokenGatedContent.findByIdAndDelete(contentId);
    
    return res.status(200).json({
      message: 'Token-gated content deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting token-gated content:', error);
    return res.status(500).json({ error: 'Error deleting token-gated content' });
  }
};

module.exports = {
  createContent,
  getAllContent,
  getContentById,
  checkContentAccess,
  updateContent,
  deleteContent
};
