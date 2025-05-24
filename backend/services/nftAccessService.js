// services/nftAccessService.js - NFT-based access control

const nftVerificationService = require('./nftVerificationService');
const NFTAccess = require('../models/NFTAccess');
const NFTOwnership = require('../models/NFTOwnership');
const AccessGrant = require('../models/AccessGrant');
const User = require('../models/User');
const crypto = require('crypto');

class NFTAccessService {
  /**
   * Check if a user has access to a resource via NFT ownership
   * @param {string} userId - The user requesting access
   * @param {string} resourceId - Resource being accessed
   * @param {string} resourceModel - Type of resource
   * @param {string} accessLevel - Required access level
   * @returns {Promise<Object>} Access result with permission details
   */
  async checkAccess(userId, resourceId, resourceModel, accessLevel = 'view') {
    try {
      // Get the user to check their wallet addresses
      const user = await User.findById(userId).select('walletAddresses');
      
      if (!user || !user.walletAddresses || user.walletAddresses.length === 0) {
        return {
          hasAccess: false,
          reason: 'No wallet addresses found for user'
        };
      }
      
      // Get the required NFTs for this resource
      const requiredNFTs = await NFTAccess.getRequiredNFTs(resourceId, resourceModel);
      
      if (!requiredNFTs || requiredNFTs.length === 0) {
        return {
          hasAccess: false,
          reason: 'No NFT access rules defined for this resource'
        };
      }
      
      // Extract wallet addresses from user
      const walletAddresses = user.walletAddresses.map(w => w.address);
      
      // Check each wallet against required NFTs
      const accessResults = await Promise.all(
        requiredNFTs.map(async (access) => {
          // Check if any of the user's wallets owns this NFT
          const ownershipResults = await Promise.all(
            walletAddresses.map(async (walletAddress) => {
              // First check our database
              const isOwnerInDb = await NFTOwnership.isNFTOwner(
                access.nftAddress,
                walletAddress
              );
              
              // If not found in database, verify on-chain
              if (!isOwnerInDb) {
                const isOwnerOnChain = await nftVerificationService.verifyNFTOwnership(
                  access.nftAddress,
                  walletAddress
                );
                
                // If verified on-chain, record in database
                if (isOwnerOnChain) {
                  await NFTOwnership.recordOwnership({
                    nftAddress: access.nftAddress,
                    walletAddress,
                    metadata: await nftVerificationService.getNFTMetadata(access.nftAddress)
                  }, userId);
                }
                
                return isOwnerOnChain;
              }
              
              return isOwnerInDb;
            })
          );
          
          // Check if any wallet owns this NFT
          const ownsRequiredNFT = ownershipResults.some(result => result === true);
          
          // Check if this access rule grants the required access level
          const hasRequiredAccess = 
            access.accessLevel === accessLevel || 
            this._accessLevelCovers(access.accessLevel, accessLevel);
          
          return {
            accessRule: access,
            ownsNFT: ownsRequiredNFT,
            hasRequiredAccess: hasRequiredAccess,
            overallAccess: ownsRequiredNFT && hasRequiredAccess
          };
        })
      );
      
      // User has access if they satisfy at least one access rule
      const hasAccess = accessResults.some(result => result.overallAccess);
      
      // Format the response
      if (hasAccess) {
        return {
          hasAccess: true,
          accessRules: accessResults.filter(r => r.overallAccess),
          allRules: accessResults
        };
      } else {
        return {
          hasAccess: false,
          reason: 'No matching NFT ownership for required access',
          missingNFTs: accessResults
            .filter(r => !r.ownsNFT)
            .map(r => r.accessRule.nftAddress),
          allRules: accessResults
        };
      }
    } catch (error) {
      console.error('NFT access check error:', error);
      return {
        hasAccess: false,
        reason: 'Error checking access',
        error: error.message
      };
    }
  }
  
  /**
   * Generate an access grant for a resource
   * @param {string} userId - User ID
   * @param {Object} resource - Resource to access
   * @param {Object} nft - NFT used for access
   * @param {string} accessLevel - Level of access
   * @returns {Promise<Object>} Generated access grant
   */
  async generateAccessGrant(userId, resource, nft, accessLevel = 'view') {
    try {
      // Check for existing active grant
      const existingGrant = await AccessGrant.findActive(
        userId,
        resource.id,
        resource.model
      );
      
      if (existingGrant) {
        return existingGrant;
      }
      
      // Generate a secure token
      const token = AccessGrant.generateAccessToken();
      
      // Calculate expiration (default: 1 hour)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);
      
      // Create the access grant
      const grant = await AccessGrant.create({
        user: userId,
        resource: {
          id: resource.id,
          model: resource.model,
          title: resource.title || 'Untitled Resource',
          type: resource.type || 'content'
        },
        nft: {
          address: nft.address,
          walletAddress: nft.walletAddress
        },
        accessLevel,
        expiresAt,
        token,
        ipAddress: resource.ipAddress,
        userAgent: resource.userAgent,
        metadata: new Map([
          ['grantReason', 'NFT Ownership'],
          ['maxUsage', 10], // Default limit
          ['resourceMetadata', resource.metadata || {}]
        ])
      });
      
      return grant;
    } catch (error) {
      console.error('Generate access grant error:', error);
      throw error;
    }
  }
  
  /**
   * Verify an access grant by token
   * @param {string} token - Access token
   * @returns {Promise<Object>} Verification result
   */
  async verifyAccessGrant(token) {
    try {
      const grant = await AccessGrant.findByToken(token);
      
      if (!grant) {
        return {
          isValid: false,
          reason: 'Access token not found'
        };
      }
      
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
        grant,
        resource: grant.resource
      };
    } catch (error) {
      console.error('Verify access grant error:', error);
      return {
        isValid: false,
        reason: 'Error verifying access token',
        error: error.message
      };
    }
  }
  
  /**
   * Define NFT access rules for a resource
   * @param {string} resourceId - Resource ID
   * @param {string} resourceModel - Resource type
   * @param {Array} nftRules - Array of NFT access rules
   * @param {string} creatorId - User ID of creator
   * @returns {Promise<Array>} Created access rules
   */
  async defineAccessRules(resourceId, resourceModel, nftRules, creatorId) {
    try {
      const results = [];
      
      // Process each rule
      for (const rule of nftRules) {
        try {
          // Create or update the access rule
          const accessRule = await NFTAccess.findOneAndUpdate(
            {
              nftAddress: rule.nftAddress,
              resourceId,
              resourceModel
            },
            {
              nftAddress: rule.nftAddress,
              resourceId,
              resourceModel,
              accessLevel: rule.accessLevel || 'view',
              temporaryAccess: rule.temporaryAccess || false,
              expiresAt: rule.expiresAt,
              restrictions: rule.restrictions || {},
              createdBy: creatorId,
              isActive: true,
              updatedAt: new Date()
            },
            {
              upsert: true,
              new: true,
              setDefaultsOnInsert: true
            }
          );
          
          results.push({
            success: true,
            rule: accessRule
          });
        } catch (ruleError) {
          console.error('Error creating access rule:', ruleError);
          results.push({
            success: false,
            nftAddress: rule.nftAddress,
            error: ruleError.message
          });
        }
      }
      
      return {
        totalRules: nftRules.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        rules: results
      };
    } catch (error) {
      console.error('Define access rules error:', error);
      throw error;
    }
  }
  
  /**
   * Sync NFT ownership for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Sync results
   */
  async syncUserNFTs(userId) {
    try {
      const user = await User.findById(userId).select('walletAddresses');
      
      if (!user || !user.walletAddresses || user.walletAddresses.length === 0) {
        return {
          success: false,
          reason: 'No wallet addresses found for user'
        };
      }
      
      const results = await Promise.all(
        user.walletAddresses.map(async (wallet) => {
          try {
            const syncResult = await nftVerificationService.syncWalletNFTs(
              wallet.address,
              userId
            );
            
            return {
              wallet: wallet.address,
              success: true,
              ...syncResult
            };
          } catch (error) {
            console.error(`Error syncing wallet ${wallet.address}:`, error);
            return {
              wallet: wallet.address,
              success: false,
              error: error.message
            };
          }
        })
      );
      
      return {
        totalWallets: user.walletAddresses.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results
      };
    } catch (error) {
      console.error('Sync user NFTs error:', error);
      throw error;
    }
  }
  
  /**
   * Get all resources a user has access to
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Accessible resources
   */
  async getAccessibleResources(userId) {
    try {
      // Get user's NFTs from database
      const ownedNFTs = await NFTOwnership.find({
        user: userId,
        status: 'active'
      }).select('nftAddress');
      
      if (!ownedNFTs || ownedNFTs.length === 0) {
        return {
          count: 0,
          resources: []
        };
      }
      
      // Get NFT addresses
      const nftAddresses = ownedNFTs.map(nft => nft.nftAddress);
      
      // Find access rules that match these NFTs
      const accessRules = await NFTAccess.find({
        nftAddress: { $in: nftAddresses },
        isActive: true,
        $or: [
          { temporaryAccess: false },
          { temporaryAccess: true, expiresAt: { $gt: new Date() } }
        ]
      }).populate('resourceId');
      
      // Group by resource
      const resourceMap = new Map();
      
      for (const rule of accessRules) {
        if (!rule.resourceId) continue;
        
        const key = `${rule.resourceModel}:${rule.resourceId._id}`;
        
        if (!resourceMap.has(key)) {
          resourceMap.set(key, {
            resource: rule.resourceId,
            model: rule.resourceModel,
            accessRules: [rule],
            highestAccess: rule.accessLevel
          });
        } else {
          const entry = resourceMap.get(key);
          entry.accessRules.push(rule);
          
          // Update highest access level
          if (this._accessLevelValue(rule.accessLevel) > this._accessLevelValue(entry.highestAccess)) {
            entry.highestAccess = rule.accessLevel;
          }
        }
      }
      
      return {
        count: resourceMap.size,
        resources: Array.from(resourceMap.values())
      };
    } catch (error) {
      console.error('Get accessible resources error:', error);
      throw error;
    }
  }
  
  /**
   * Helper to check if one access level covers another
   * @private
   */
  _accessLevelCovers(providedLevel, requiredLevel) {
    const levels = {
      'admin': 5,
      'edit': 4,
      'download': 3,
      'stream': 2,
      'view': 1
    };
    
    return levels[providedLevel] >= levels[requiredLevel];
  }
  
  /**
   * Helper to get numeric value for access level
   * @private
   */
  _accessLevelValue(level) {
    const levels = {
      'admin': 5,
      'edit': 4,
      'download': 3,
      'stream': 2,
      'view': 1
    };
    
    return levels[level] || 0;
  }
  
  /**
   * Clean up expired grants and update NFT verification cache
   * Can be run as a scheduled job
   * @public
   */
  async maintenance() {
    try {
      // Clean up expired grants
      const expiredCount = await AccessGrant.cleanupExpired();
      
      // Clear verification cache
      nftVerificationService.clearCaches();
      
      return {
        expiredGrants: expiredCount,
        cacheCleared: true,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Maintenance error:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new NFTAccessService();
