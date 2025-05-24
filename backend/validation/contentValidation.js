// utils/contentAccessValidator.js - Validation functions for NFT-gated content access

const NFTAccess = require('../models/NFTAccess');
const NFTOwnership = require('../models/NFTOwnership');
const AccessGrant = require('../models/AccessGrant');
const nftVerificationService = require('../services/nftVerificationService');
const crypto = require('crypto');

/**
 * Comprehensive content access validator
 * Core function for validating user access to exclusive content
 */
class ContentAccessValidator {
  /**
   * Validate if a user can access content based on NFT ownership
   * 
   * @param {Object} user - User object
   * @param {Object} content - Content object
   * @param {string} accessLevel - Required access level
   * @returns {Promise<Object>} Validation result
   */
  static async validateAccess(user, content, accessLevel = 'view') {
    try {
      // Skip validation for admins and content creators
      if (user.role === 'admin' || (content.artist && content.artist.toString() === user._id.toString())) {
        return {
          hasAccess: true,
          accessMethod: user.role === 'admin' ? 'admin' : 'creator',
          accessLevel: 'admin'
        };
      }
      
      // Check if content is public
      if (content.accessControl?.type === 'public') {
        return {
          hasAccess: true,
          accessMethod: 'public',
          accessLevel: 'view'
        };
      }
      
      // Check if content is available
      const isAvailable = this._checkAvailability(content);
      if (!isAvailable) {
        return {
          hasAccess: false,
          reason: 'Content is not available',
          details: 'The content is outside its availability window'
        };
      }
      
      // Track validation results from different methods
      const validationResults = [];
      
      // Validate NFT-based access if required
      if (content.accessControl?.type === 'nft-based' || content.accessControl?.type === 'hybrid') {
        const nftResult = await this._validateNFTAccess(user, content, accessLevel);
        validationResults.push(nftResult);
        
        // Early return if access granted
        if (nftResult.hasAccess) {
          return nftResult;
        }
      }
      
      // Validate ticket-based access if required
      if (content.accessControl?.type === 'ticket-based' || content.accessControl?.type === 'hybrid') {
        const ticketResult = await this._validateTicketAccess(user, content);
        validationResults.push(ticketResult);
        
        // Early return if access granted
        if (ticketResult.hasAccess) {
          return ticketResult;
        }
      }
      
      // If we reach here, no validation method succeeded
      return {
        hasAccess: false,
        reason: 'Access requirements not met',
        details: 'User does not meet any of the access requirements',
        validationResults
      };
    } catch (error) {
      console.error('Content access validation error:', error);
      return {
        hasAccess: false,
        reason: 'Validation error',
        error: error.message
      };
    }
  }
  
  /**
   * Validate NFT-based access
   * @private
   */
  static async _validateNFTAccess(user, content, accessLevel) {
    try {
      // Check if user has connected wallets
      if (!user.walletAddresses || user.walletAddresses.length === 0) {
        return {
          hasAccess: false,
          accessMethod: 'nft',
          reason: 'No connected wallets',
          details: 'User has no connected wallet addresses'
        };
      }
      
      // Find applicable NFT access rules for this content
      const accessRules = await NFTAccess.find({
        resourceId: content._id,
        resourceModel: 'ExclusiveContent',
        isActive: true,
        $or: [
          { temporaryAccess: false },
          { temporaryAccess: true, expiresAt: { $gt: new Date() } }
        ]
      });
      
      // If no access rules found, deny access
      if (!accessRules || accessRules.length === 0) {
        return {
          hasAccess: false,
          accessMethod: 'nft',
          reason: 'No access rules',
          details: 'No NFT access rules defined for this content'
        };
      }
      
      // Extract user's wallet addresses
      const walletAddresses = user.walletAddresses.map(w => w.address);
      
      // Check each access rule to see if user owns required NFT
      const ruleResults = await Promise.all(
        accessRules.map(async rule => {
          // Skip rules not granting required access level
          if (!this._accessLevelCovers(rule.accessLevel, accessLevel)) {
            return {
              rule,
              hasAccess: false,
              reason: 'Insufficient access level',
              details: `Rule grants ${rule.accessLevel}, but ${accessLevel} is required`
            };
          }
          
          // Check if any wallet owns this NFT
          let ownsNFT = false;
          let ownerWallet = null;
          
          // First check database for cached ownership
          for (const wallet of walletAddresses) {
            const isOwner = await NFTOwnership.isNFTOwner(rule.nftAddress, wallet);
            if (isOwner) {
              ownsNFT = true;
              ownerWallet = wallet;
              break;
            }
          }
          
          // If not found in database, check on-chain
          if (!ownsNFT) {
            for (const wallet of walletAddresses) {
              const isOwnerOnChain = await nftVerificationService.verifyNFTOwnership(
                rule.nftAddress,
                wallet
              );
              
              if (isOwnerOnChain) {
                // Record ownership in database
                await NFTOwnership.recordOwnership({
                  nftAddress: rule.nftAddress,
                  walletAddress: wallet,
                  metadata: await nftVerificationService.getNFTMetadata(rule.nftAddress)
                }, user._id);
                
                ownsNFT = true;
                ownerWallet = wallet;
                break;
              }
            }
          }
          
          // Check restrictions if NFT is owned
          let passesRestrictions = true;
          let restrictionDetails = null;
          
          if (ownsNFT && rule.restrictions) {
            const restrictionCheck = this._checkRestrictions(rule.restrictions);
            passesRestrictions = restrictionCheck.passes;
            restrictionDetails = restrictionCheck.details;
          }
          
          return {
            rule,
            hasAccess: ownsNFT && passesRestrictions,
            ownsNFT,
            passesRestrictions,
            ownerWallet,
            restrictionDetails
          };
        })
      );
      
      // Check if any rule grants access
      const accessGrantingRule = ruleResults.find(result => result.hasAccess);
      
      if (accessGrantingRule) {
        return {
          hasAccess: true,
          accessMethod: 'nft',
          accessLevel: accessGrantingRule.rule.accessLevel,
          nftAddress: accessGrantingRule.rule.nftAddress,
          walletAddress: accessGrantingRule.ownerWallet,
          rule: accessGrantingRule.rule
        };
      }
      
      // If we reach here, no rule granted access
      return {
        hasAccess: false,
        accessMethod: 'nft',
        reason: 'NFT ownership requirement not met',
        requiredNFTs: accessRules.map(rule => rule.nftAddress),
        ruleResults
      };
    } catch (error) {
      console.error('NFT access validation error:', error);
      return {
        hasAccess: false,
        accessMethod: 'nft',
        reason: 'Validation error',
        error: error.message
      };
    }
  }
  
  /**
   * Validate ticket-based access
   * @private
   */
  static async _validateTicketAccess(user, content) {
    // This implementation depends on your ticket model
    // For now, we'll return a placeholder
    return {
      hasAccess: false,
      accessMethod: 'ticket',
      reason: 'Not implemented',
      details: 'Ticket-based validation not yet implemented'
    };
  }
  
  /**
   * Check if content is within availability window
   * @private
   */
  static _checkAvailability(content) {
    const now = new Date();
    
    // Check if before availableFrom date
    if (content.availableFrom && now < new Date(content.availableFrom)) {
      return false;
    }
    
    // Check if after availableUntil date
    if (content.availableUntil && now > new Date(content.availableUntil)) {
      return false;
    }
    
    // Check if content is published
    return content.status === 'published';
  }
  
  /**
   * Check if one access level covers another
   * @private
   */
  static _accessLevelCovers(providedLevel, requiredLevel) {
    const levels = {
      'admin': 5,
      'edit': 4,
      'download': 3,
      'stream': 2,
      'view': 1
    };
    
    return (levels[providedLevel] || 0) >= (levels[requiredLevel] || 0);
  }
  
  /**
   * Check if access restrictions are satisfied
   * @private
   */
  static _checkRestrictions(restrictions) {
    // This would implement checking various restrictions
    // Like IP limits, device limits, etc.
    return {
      passes: true,
      details: 'No restrictions enforced yet'
    };
  }
  
  /**
   * Generate a secure access token
   * 
   * @param {Object} user - User object
   * @param {Object} content - Content object
   * @param {string} accessLevel - Access level granted
   * @param {Object} accessInfo - Additional access information
   * @returns {Promise<Object>} Generated token info
   */
  static async generateAccessToken(user, content, accessLevel, accessInfo) {
    try {
      // Generate a secure random token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Set expiration (1 hour by default)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);
      
      // Create access grant record
      const grant = await AccessGrant.create({
        user: user._id,
        resource: {
          id: content._id,
          model: 'ExclusiveContent',
          title: content.title || 'Untitled Content',
          type: content.contentType || 'content'
        },
        nft: {
          address: accessInfo.nftAddress || null,
          walletAddress: accessInfo.walletAddress || null
        },
        accessLevel,
        expiresAt,
        token,
        ipAddress: accessInfo.ipAddress,
        userAgent: accessInfo.userAgent,
        metadata: new Map([
          ['accessMethod', accessInfo.accessMethod || 'nft'],
          ['contentId', content.contentId],
          ['createdAt', new Date()]
        ])
      });
      
      return {
        token,
        expiresAt,
        accessLevel,
        accessMethod: accessInfo.accessMethod || 'nft',
        grantId: grant._id
      };
    } catch (error) {
      console.error('Generate access token error:', error);
      throw error;
    }
  }
  
  /**
   * Verify an access token for content
   * 
   * @param {string} token - Access token
   * @param {string} contentId - Content ID
   * @returns {Promise<Object>} Verification result
   */
  static async verifyAccessToken(token, contentId) {
    try {
      // Find the grant by token
      const grant = await AccessGrant.findOne({ token });
      
      if (!grant) {
        return {
          isValid: false,
          reason: 'Token not found'
        };
      }
      
      // Check if grant is for the specified content
      if (contentId && 
          grant.metadata && 
          grant.metadata.get('contentId') !== contentId) {
        return {
          isValid: false,
          reason: 'Token not valid for this content',
          contentId
        };
      }
      
      // Check token validity
      if (!grant.isValid()) {
        return {
          isValid: false,
          reason: grant.status === 'expired' ? 'Token expired' : `Token ${grant.status}`,
          status: grant.status
        };
      }
      
      // Record usage
      const used = await grant.use();
      
      if (!used) {
        return {
          isValid: false,
          reason: 'Failed to use access token',
          status: grant.status
        };
      }
      
      return {
        isValid: true,
        accessLevel: grant.accessLevel,
        resource: grant.resource,
        usageCount: grant.usageCount,
        expiresAt: grant.expiresAt
      };
    } catch (error) {
      console.error('Verify access token error:', error);
      return {
        isValid: false,
        reason: 'Error verifying token',
        error: error.message
      };
    }
  }
  
  /**
   * Get all content accessible to a user via their NFTs
   * 
   * @param {Object} user - User object
   * @returns {Promise<Array>} Array of accessible content IDs with access info
   */
  static async getAccessibleContent(user) {
    try {
      // Get user's NFTs from database
      const ownedNFTs = await NFTOwnership.find({
        user: user._id,
        status: 'active'
      }).select('nftAddress');
      
      if (!ownedNFTs || ownedNFTs.length === 0) {
        return [];
      }
      
      // Get NFT addresses
      const nftAddresses = ownedNFTs.map(nft => nft.nftAddress);
      
      // Find all access rules that match these NFTs
      const accessRules = await NFTAccess.find({
        nftAddress: { $in: nftAddresses },
        resourceModel: 'ExclusiveContent',
        isActive: true,
        $or: [
          { temporaryAccess: false },
          { temporaryAccess: true, expiresAt: { $gt: new Date() } }
        ]
      });
      
      // Group by content ID
      const contentAccessMap = {};
      
      accessRules.forEach(rule => {
        const contentId = rule.resourceId.toString();
        
        if (!contentAccessMap[contentId]) {
          contentAccessMap[contentId] = {
            contentId,
            accessRules: [rule],
            highestAccessLevel: rule.accessLevel,
            nftAddresses: [rule.nftAddress]
          };
        } else {
          contentAccessMap[contentId].accessRules.push(rule);
          contentAccessMap[contentId].nftAddresses.push(rule.nftAddress);
          
          // Update highest access level
          if (this._accessLevelValue(rule.accessLevel) > 
              this._accessLevelValue(contentAccessMap[contentId].highestAccessLevel)) {
            contentAccessMap[contentId].highestAccessLevel = rule.accessLevel;
          }
        }
      });
      
      return Object.values(contentAccessMap);
    } catch (error) {
      console.error('Get accessible content error:', error);
      throw error;
    }
  }
  
  /**
   * Helper to get numeric value for access level
   * @private
   */
  static _accessLevelValue(level) {
    const levels = {
      'admin': 5,
      'edit': 4,
      'download': 3,
      'stream': 2,
      'view': 1
    };
    
    return levels[level] || 0;
  }
}

module.exports = ContentAccessValidator;
