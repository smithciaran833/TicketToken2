// services/profileService.js - Profile business logic service

const User = require('../models/User');
const { calculateProfileCompletion } = require('../utils/profileAnalytics');
const { sendNotification } = require('./notificationService');

class ProfileService {
  // Get comprehensive profile data
  static async getProfileData(userId) {
    try {
      const user = await User.findById(userId)
        .select('-passwordHash')
        .lean();

      if (!user) {
        throw new Error('User not found');
      }

      return {
        ...user,
        profileCompletion: calculateProfileCompletion(user),
        accountAge: Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        primaryWallet: user.walletAddresses.find(w => w.isPrimary)?.address || null,
        securityScore: this.calculateSecurityScore(user),
        activityStatus: this.getActivityStatus(user.lastLoginAt),
      };
    } catch (error) {
      throw new Error(`Failed to get profile data: ${error.message}`);
    }
  }

  // Update profile with validation and notifications
  static async updateProfile(userId, updateData) {
    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      const oldProfile = { ...user.toObject() };
      const updatedFields = [];
      
      // Update basic fields
      const fieldsToUpdate = ['username', 'email', 'displayName', 'bio', 'profileImage'];
      
      fieldsToUpdate.forEach(field => {
        if (updateData[field] !== undefined && updateData[field] !== user[field]) {
          user[field] = updateData[field];
          updatedFields.push(field);
        }
      });

      await user.save();

      // Send notifications for significant changes
      if (updatedFields.includes('email')) {
        await sendNotification(userId, {
          type: 'email_changed',
          message: 'Your email address has been updated',
          data: { newEmail: updateData.email }
        });
      }

      // Calculate profile completion after update
      const newProfileCompletion = calculateProfileCompletion(user);
      const oldProfileCompletion = calculateProfileCompletion(oldProfile);

      // Check for profile completion milestones
      if (newProfileCompletion > oldProfileCompletion) {
        await this.checkProfileMilestones(userId, newProfileCompletion);
      }

      return {
        user: user.toObject(),
        updatedFields,
        profileCompletion: newProfileCompletion
      };
    } catch (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }
  }

  // Calculate security score
  static calculateSecurityScore(user) {
    let score = 0;
    const checks = {
      hasPassword: user.passwordHash ? 20 : 0,
      emailVerified: user.isEmailVerified ? 20 : 0,
      multipleWallets: user.walletAddresses.length > 1 ? 15 : 0,
      hasProfileImage: user.profileImage ? 10 : 0,
      hasBio: user.bio && user.bio.length > 0 ? 10 : 0,
      socialConnections: Math.min(Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length * 5, 15),
      recentActivity: user.lastLoginAt && (Date.now() - user.lastLoginAt.getTime()) < (7 * 24 * 60 * 60 * 1000) ? 10 : 0
    };

    score = Object.values(checks).reduce((total, points) => total + points, 0);
    
    return {
      score: Math.min(score, 100),
      checks,
      recommendations: this.getSecurityRecommendations(checks)
    };
  }

  // Get security recommendations
  static getSecurityRecommendations(checks) {
    const recommendations = [];
    
    if (checks.hasPassword === 0) recommendations.push('Set up a password for additional security');
    if (checks.emailVerified === 0) recommendations.push('Verify your email address');
    if (checks.multipleWallets === 0) recommendations.push('Add multiple wallet addresses for backup');
    if (checks.hasProfileImage === 0) recommendations.push('Add a profile image to personalize your account');
    if (checks.hasBio === 0) recommendations.push('Add a bio to complete your profile');
    if (checks.socialConnections < 15) recommendations.push('Connect your social media accounts');

    return recommendations;
  }

  // Get activity status
  static getActivityStatus(lastLoginAt) {
    if (!lastLoginAt) return 'inactive';
    
    const daysSinceLastLogin = Math.floor((Date.now() - lastLoginAt.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysSinceLastLogin === 0) return 'active';
    if (daysSinceLastLogin <= 7) return 'recent';
    if (daysSinceLastLogin <= 30) return 'moderate';
    return 'inactive';
  }

  // Check profile completion milestones
  static async checkProfileMilestones(userId, completionPercentage) {
    const milestones = [25, 50, 75, 100];
    
    for (const milestone of milestones) {
      if (completionPercentage >= milestone) {
        await sendNotification(userId, {
          type: 'profile_milestone',
          message: `Congratulations! Your profile is ${milestone}% complete!`,
          data: { milestone, completionPercentage }
        });
      }
    }
  }

  // Validate social media handle
  static validateSocialHandle(handle, platform) {
    const patterns = {
      twitter: /^@?[A-Za-z0-9_]{1,15}$|^https?:\/\/(www\.)?twitter\.com\/[A-Za-z0-9_]{1,15}\/?$/,
      instagram: /^@?[A-Za-z0-9_.]{1,30}$|^https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/,
      discord: /^.{3,32}#[0-9]{4}$|^@?[A-Za-z0-9_.]{2,32}$/,
      telegram: /^@?[A-Za-z0-9_]{5,32}$|^https?:\/\/(www\.)?t\.me\/[A-Za-z0-9_]{5,32}\/?$/,
      website: /^https?:\/\/.+$/
    };

    return patterns[platform] ? patterns[platform].test(handle) : false;
  }

  // Export profile data
  static async exportProfileData(userId) {
    try {
      const user = await User.findById(userId).lean();
      
      if (!user) {
        throw new Error('User not found');
      }

      // Remove sensitive data
      const exportData = {
        ...user,
        passwordHash: undefined,
        __v: undefined
      };

      // Add computed fields
      exportData.profileCompletion = calculateProfileCompletion(user);
      exportData.accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      exportData.exportedAt = new Date();

      return exportData;
    } catch (error) {
      throw new Error(`Failed to export profile data: ${error.message}`);
    }
  }
}

module.exports = ProfileService;
