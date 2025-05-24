const ContentAccess = require('../models/contentAccess');
const TicketToken = require('../models/ticketToken');
const UserToken = require('../models/userToken');
const mongoose = require('mongoose');

/**
 * Service for handling exclusive content access based on ticket tokens
 */
class ContentAccessService {
  /**
   * Create a new content entry with token access requirements
   * @param {Object} contentData - Data for creating new content
   * @returns {Promise<Object>} - Created content object
   */
  async createContent(contentData) {
    try {
      // Validate that all required token IDs exist
      if (contentData.requiredTokens && contentData.requiredTokens.length > 0) {
        for (const tokenReq of contentData.requiredTokens) {
          const tokenExists = await TicketToken.exists({ _id: tokenReq.tokenId });
          if (!tokenExists) {
            throw new Error(`Token with ID ${tokenReq.tokenId} does not exist`);
          }
        }
      }

      const newContent = new ContentAccess(contentData);
      await newContent.save();
      return newContent;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update existing content
   * @param {string} contentId - ID of content to update
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} - Updated content object
   */
  async updateContent(contentId, updateData) {
    try {
      // Validate that all required token IDs exist if they're being updated
      if (updateData.requiredTokens && updateData.requiredTokens.length > 0) {
        for (const tokenReq of updateData.requiredTokens) {
          const tokenExists = await TicketToken.exists({ _id: tokenReq.tokenId });
          if (!tokenExists) {
            throw new Error(`Token with ID ${tokenReq.tokenId} does not exist`);
          }
        }
      }

      const updatedContent = await ContentAccess.findByIdAndUpdate(
        contentId,
        { ...updateData, updatedAt: Date.now() },
        { new: true, runValidators: true }
      );

      if (!updatedContent) {
        throw new Error('Content not found');
      }

      return updatedContent;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Delete content
   * @param {string} contentId - ID of content to delete
   * @returns {Promise<boolean>} - Success status
   */
  async deleteContent(contentId) {
    try {
      const result = await ContentAccess.findByIdAndDelete(contentId);
      return !!result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get content by ID
   * @param {string} contentId - ID of content to retrieve
   * @returns {Promise<Object>} - Content object
   */
  async getContentById(contentId) {
    try {
      const content = await ContentAccess.findById(contentId)
        .populate('createdBy', 'name email')
        .populate('requiredTokens.tokenId', 'name symbol');
      
      if (!content) {
        throw new Error('Content not found');
      }
      
      return content;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all content entries with optional filtering
   * @param {Object} filters - Optional filters
   * @returns {Promise<Array>} - Array of content objects
   */
  async getAllContent(filters = {}) {
    try {
      let query = {};
      
      // Apply filters
      if (filters.isActive !== undefined) {
        query.isActive = filters.isActive;
      }
      
      if (filters.createdBy) {
        query.createdBy = filters.createdBy;
      }
      
      if (filters.contentType) {
        query.contentType = filters.contentType;
      }
      
      if (filters.requiredTokenId) {
        query['requiredTokens.tokenId'] = filters.requiredTokenId;
      }
      
      // Search in title and description
      if (filters.search) {
        query.$text = { $search: filters.search };
      }
      
      // Date range filters
      if (filters.validFrom) {
        query.validFrom = { $gte: new Date(filters.validFrom) };
      }
      
      if (filters.validUntil) {
        query.validUntil = { $lte: new Date(filters.validUntil) };
      }
      
      // Execute query with pagination
      const page = parseInt(filters.page) || 1;
      const limit = parseInt(filters.limit) || 10;
      const skip = (page - 1) * limit;
      
      const contentList = await ContentAccess.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'name email')
        .populate('requiredTokens.tokenId', 'name symbol');
      
      const total = await ContentAccess.countDocuments(query);
      
      return {
        data: contentList,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Validate if a user has access to specific content
   * @param {string} userId - User ID to check
   * @param {string} contentId - Content ID to check access for
   * @returns {Promise<Object>} - Access validation result
   */
  async validateUserAccess(userId, contentId) {
    try {
      // Get the content
      const content = await ContentAccess.findById(contentId);
      if (!content) {
        throw new Error('Content not found');
      }
      
      // Check if content is active and within valid date range
      const now = new Date();
      if (!content.isActive) {
        return { hasAccess: false, reason: 'Content is not active' };
      }
      
      if (content.validFrom && content.validFrom > now) {
        return { hasAccess: false, reason: 'Content is not yet available' };
      }
      
      if (content.validUntil && content.validUntil < now) {
        return { hasAccess: false, reason: 'Content has expired' };
      }
      
      // If no tokens required, grant access
      if (!content.requiredTokens || content.requiredTokens.length === 0) {
        return { hasAccess: true, accessLevel: null };
      }
      
      // Get user's tokens that match required tokens
      const userTokens = await UserToken.find({
        userId: userId,
        tokenId: { $in: content.requiredTokens.map(t => t.tokenId) }
      });
      
      // Create a map of user's token quantities
      const userTokenMap = {};
      userTokens.forEach(ut => {
        userTokenMap[ut.tokenId.toString()] = ut.quantity;
      });
      
      // Check if user has all required tokens
      const missingTokens = [];
      let hasRequiredTokens = true;
      
      for (const requiredToken of content.requiredTokens) {
        const tokenId = requiredToken.tokenId.toString();
        const requiredQuantity = requiredToken.minQuantity || 1;
        const userQuantity = userTokenMap[tokenId] || 0;
        
        if (userQuantity < requiredQuantity) {
          hasRequiredTokens = false;
          
          const tokenDetails = await TicketToken.findById(tokenId).select('name');
          missingTokens.push({
            tokenId,
            name: tokenDetails ? tokenDetails.name : 'Unknown Token',
            required: requiredQuantity,
            userHas: userQuantity
          });
        }
      }
      
      if (!hasRequiredTokens) {
        return {
          hasAccess: false,
          reason: 'Missing required tokens',
          missingTokens
        };
      }
      
      // Determine access level
      let accessLevel = null;
      
      if (content.accessLevels && content.accessLevels.length > 0) {
        // Calculate total tokens the user has
        const totalUserTokens = Object.values(userTokenMap).reduce((sum, qty) => sum + qty, 0);
        
        // Sort access levels by required quantity (descending)
        const sortedLevels = [...content.accessLevels].sort(
          (a, b) => b.requiredTokenQuantity - a.requiredTokenQuantity
        );
        
        // Find highest access level user qualifies for
        for (const level of sortedLevels) {
          if (totalUserTokens >= level.requiredTokenQuantity) {
            accessLevel = level;
            break;
          }
        }
      }
      
      return {
        hasAccess: true,
        accessLevel,
        userTokens: userTokens.map(ut => ({
          id: ut.tokenId,
          quantity: ut.quantity
        }))
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get all content a user has access to
   * @param {string} userId - User ID to check
   * @returns {Promise<Array>} - Array of accessible content
   */
  async getUserAccessibleContent(userId) {
    try {
      // Get all active content
      const allContent = await ContentAccess.find({ 
        isActive: true,
        validFrom: { $lte: new Date() },
        $or: [
          { validUntil: { $exists: false } },
          { validUntil: null },
          { validUntil: { $gt: new Date() } }
        ]
      });
      
      // Get all user tokens
      const userTokens = await UserToken.find({ userId });
      
      // Create a map of user's token quantities
      const userTokenMap = {};
      userTokens.forEach(ut => {
        userTokenMap[ut.tokenId.toString()] = ut.quantity;
      });
      
      // Filter content that user has access to
      const accessibleContent = [];
      
      for (const content of allContent) {
        // If no tokens required, add to accessible list
        if (!content.requiredTokens || content.requiredTokens.length === 0) {
          accessibleContent.push({
            content,
            accessLevel: null
          });
          continue;
        }
        
        // Check if user has all required tokens
        let hasAllRequiredTokens = true;
        
        for (const requiredToken of content.requiredTokens) {
          const tokenId = requiredToken.tokenId.toString();
          const requiredQuantity = requiredToken.minQuantity || 1;
          const userQuantity = userTokenMap[tokenId] || 0;
          
          if (userQuantity < requiredQuantity) {
            hasAllRequiredTokens = false;
            break;
          }
        }
        
        if (!hasAllRequiredTokens) {
          continue; // Skip this content
        }
        
        // Determine access level
        let accessLevel = null;
        
        if (content.accessLevels && content.accessLevels.length > 0) {
          // Calculate total tokens the user has
          const totalUserTokens = Object.values(userTokenMap).reduce((sum, qty) => sum + qty, 0);
          
          // Sort access levels by required quantity (descending)
          const sortedLevels = [...content.accessLevels].sort(
            (a, b) => b.requiredTokenQuantity - a.requiredTokenQuantity
          );
          
          // Find highest access level user qualifies for
          for (const level of sortedLevels) {
            if (totalUserTokens >= level.requiredTokenQuantity) {
              accessLevel = level;
              break;
            }
          }
        }
        
        accessibleContent.push({
          content,
          accessLevel
        });
      }
      
      return accessibleContent;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new ContentAccessService();
