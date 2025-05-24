const contentAccessService = require('../services/contentAccessService');

/**
 * Controller for handling exclusive content access operations
 */
exports.createContent = async (req, res) => {
  try {
    // Add creator ID from authenticated user
    const contentData = {
      ...req.body,
      createdBy: req.user.id
    };
    
    const newContent = await contentAccessService.createContent(contentData);
    
    return res.status(201).json({
      success: true,
      message: 'Content created successfully',
      data: newContent
    });
  } catch (error) {
    console.error('Create content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error creating content',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.updateContent = async (req, res) => {
  try {
    const contentId = req.params.id;
    const updateData = req.body;
    
    // Prevent updating createdBy field
    if (updateData.createdBy) {
      delete updateData.createdBy;
    }
    
    const updatedContent = await contentAccessService.updateContent(contentId, updateData);
    
    return res.status(200).json({
      success: true,
      message: 'Content updated successfully',
      data: updatedContent
    });
  } catch (error) {
    console.error('Update content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error updating content',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.deleteContent = async (req, res) => {
  try {
    const contentId = req.params.id;
    const deleted = await contentAccessService.deleteContent(contentId);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    console.error('Delete content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error deleting content',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.getContentById = async (req, res) => {
  try {
    const contentId = req.params.id;
    const content = await contentAccessService.getContentById(contentId);
    
    return res.status(200).json({
      success: true,
      data: content
    });
  } catch (error) {
    console.error('Get content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error retrieving content',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.getAllContent = async (req, res) => {
  try {
    const filters = req.query;
    const result = await contentAccessService.getAllContent(filters);
    
    return res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Get all content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error retrieving content list',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.validateAccess = async (req, res) => {
  try {
    const userId = req.user.id;
    const contentId = req.params.id;
    
    const validationResult = await contentAccessService.validateUserAccess(userId, contentId);
    
    return res.status(200).json({
      success: true,
      ...validationResult
    });
  } catch (error) {
    console.error('Validate access error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error validating content access',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.getUserAccessibleContent = async (req, res) => {
  try {
    const userId = req.user.id;
    const accessibleContent = await contentAccessService.getUserAccessibleContent(userId);
    
    return res.status(200).json({
      success: true,
      data: accessibleContent
    });
  } catch (error) {
    console.error('Get accessible content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error retrieving accessible content',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

exports.accessContent = async (req, res) => {
  try {
    // The middleware has already validated access and attached
    // content and accessLevel to the request object
    
    // Handle each content type appropriately
    const content = req.content;
    const accessLevel = req.accessLevel;
    
    // Build response with appropriate URLs based on content type and access level
    let response = {
      success: true,
      message: 'Access granted',
      content: {
        id: content._id,
        title: content.title,
        description: content.description,
        contentType: content.contentType,
        contentUrl: content.contentUrl,
        thumbnailUrl: content.thumbnailUrl
      }
    };
    
    // Add access level details if they exist
    if (accessLevel) {
      response.accessLevel = {
        name: accessLevel.name,
        hasAdditionalContent: accessLevel.additionalContent,
        additionalContentUrl: accessLevel.additionalContentUrl
      };
    }
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Access content error:', error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Error accessing content',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
