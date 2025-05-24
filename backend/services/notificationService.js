// services/notificationService.js - Profile update notifications

const mongoose = require('mongoose');

// Notification schema (for future implementation)
const NotificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: [
      'profile_updated', 'email_changed', 'password_changed', 'wallet_added', 
      'wallet_removed', 'profile_milestone', 'security_alert', 'achievement_unlocked',
      'social_connected', 'preferences_updated', 'image_uploaded'
    ],
    required: true 
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: Object, default: {} },
  read: { type: Boolean, default: false },
  readAt: Date,
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high', 'urgent'], 
    default: 'medium' 
  },
  channel: {
    type: String,
    enum: ['in-app', 'email', 'push'],
    default: 'in-app'
  },
  expiresAt: Date,
  createdAt: { type: Date, default: Date.now }
});

NotificationSchema.index({ userId: 1, read: 1 });
NotificationSchema.index({ createdAt: -1 });
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Notification = mongoose.model('Notification', NotificationSchema);

class NotificationService {
  // Send a notification to a user
  static async sendNotification(userId, notificationData) {
    try {
      const { type, message, data = {}, priority = 'medium', channel = 'in-app' } = notificationData;
      
      // Generate title based on type if not provided
      const title = notificationData.title || this.generateTitle(type, data);
      
      // Create notification
      const notification = new Notification({
        userId,
        type,
        title,
        message,
        data,
        priority,
        channel,
        expiresAt: this.calculateExpiration(type)
      });

      await notification.save();

      // Handle different notification channels
      if (channel === 'email' || priority === 'urgent') {
        await this.sendEmailNotification(userId, notification);
      }

      if (channel === 'push') {
        await this.sendPushNotification(userId, notification);
      }

      // Emit real-time notification (for WebSocket implementation)
      await this.emitRealTimeNotification(userId, notification);

      return notification;
    } catch (error) {
      console.error('Failed to send notification:', error);
      throw new Error('Failed to send notification');
    }
  }

  // Send bulk notifications
  static async sendBulkNotifications(userIds, notificationData) {
    try {
      const notifications = userIds.map(userId => ({
        userId,
        ...notificationData,
        title: notificationData.title || this.generateTitle(notificationData.type, notificationData.data),
        expiresAt: this.calculateExpiration(notificationData.type)
      }));

      const result = await Notification.insertMany(notifications);
      
      // Handle email/push for urgent notifications
      if (notificationData.priority === 'urgent') {
        await Promise.allSettled(
          userIds.map(userId => this.sendEmailNotification(userId, notificationData))
        );
      }

      return result;
    } catch (error) {
      console.error('Failed to send bulk notifications:', error);
      throw new Error('Failed to send bulk notifications');
    }
  }

  // Get user notifications
  static async getUserNotifications(userId, options = {}) {
    try {
      const {
        limit = 50,
        page = 1,
        unreadOnly = false,
        type = null,
        priority = null
      } = options;

      const query = { userId };
      
      if (unreadOnly) query.read = false;
      if (type) query.type = type;
      if (priority) query.priority = priority;

      const notifications = await Notification
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean();

      const total = await Notification.countDocuments(query);
      const unreadCount = await Notification.countDocuments({ userId, read: false });

      return {
        notifications,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        },
        unreadCount
      };
    } catch (error) {
      console.error('Failed to get notifications:', error);
      throw new Error('Failed to get notifications');
    }
  }

  // Mark notifications as read
  static async markAsRead(userId, notificationIds) {
    try {
      const result = await Notification.updateMany(
        { 
          _id: { $in: notificationIds },
          userId,
          read: false
        },
        { 
          read: true,
          readAt: new Date()
        }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error('Failed to mark notifications as read:', error);
      throw new Error('Failed to mark notifications as read');
    }
  }

  // Mark all notifications as read
  static async markAllAsRead(userId) {
    try {
      const result = await Notification.updateMany(
        { userId, read: false },
        { 
          read: true,
          readAt: new Date()
        }
      );

      return result.modifiedCount;
    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      throw new Error('Failed to mark all notifications as read');
    }
  }

  // Delete notification
  static async deleteNotification(userId, notificationId) {
    try {
      const result = await Notification.deleteOne({
        _id: notificationId,
        userId
      });

      return result.deletedCount > 0;
    } catch (error) {
      console.error('Failed to delete notification:', error);
      throw new Error('Failed to delete notification');
    }
  }

  // Delete all notifications for user
  static async deleteAllNotifications(userId) {
    try {
      const result = await Notification.deleteMany({ userId });
      return result.deletedCount;
    } catch (error) {
      console.error('Failed to delete all notifications:', error);
      throw new Error('Failed to delete all notifications');
    }
  }

  // Get notification statistics
  static async getNotificationStats(userId) {
    try {
      const stats = await Notification.aggregate([
        { $match: { userId: mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            unread: { $sum: { $cond: [{ $eq: ['$read', false] }, 1, 0] } },
            byType: {
              $push: {
                type: '$type',
                read: '$read',
                priority: '$priority'
              }
            }
          }
        }
      ]);

      if (stats.length === 0) {
        return { total: 0, unread: 0, byType: {}, byPriority: {} };
      }

      const result = stats[0];
      
      // Count by type
      const byType = {};
      const byPriority = {};
      
      result.byType.forEach(item => {
        byType[item.type] = (byType[item.type] || 0) + 1;
        byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
      });

      return {
        total: result.total,
        unread: result.unread,
        byType,
        byPriority
      };
    } catch (error) {
      console.error('Failed to get notification stats:', error);
      throw new Error('Failed to get notification stats');
    }
  }

  // Send profile-specific notifications
  static async sendProfileNotification(userId, type, data = {}) {
    const notificationMap = {
      profile_updated: {
        title: 'Profile Updated',
        message: 'Your profile has been successfully updated',
        priority: 'low'
      },
      email_changed: {
        title: 'Email Address Changed',
        message: `Your email address has been changed to ${data.newEmail}`,
        priority: 'high',
        channel: 'email'
      },
      password_changed: {
        title: 'Password Changed',
        message: 'Your password has been successfully changed',
        priority: 'high',
        channel: 'email'
      },
      wallet_added: {
        title: 'Wallet Connected',
        message: `New wallet address ${data.walletAddress?.substring(0, 8)}... has been connected`,
        priority: 'medium'
      },
      wallet_removed: {
        title: 'Wallet Removed',
        message: `Wallet address ${data.walletAddress?.substring(0, 8)}... has been removed`,
        priority: 'medium'
      },
      profile_milestone: {
        title: 'Profile Milestone Achieved!',
        message: data.message || `Congratulations! Your profile is ${data.milestone}% complete!`,
        priority: 'low'
      },
      achievement_unlocked: {
        title: 'Achievement Unlocked!',
        message: data.message || `You've earned the "${data.achievementTitle}" achievement!`,
        priority: 'low'
      },
      security_alert: {
        title: 'Security Alert',
        message: data.message || 'Important security update for your account',
        priority: 'urgent',
        channel: 'email'
      },
      social_connected: {
        title: 'Social Profile Connected',
        message: `Your ${data.platform} profile has been connected`,
        priority: 'low'
      },
      preferences_updated: {
        title: 'Preferences Updated',
        message: 'Your account preferences have been updated',
        priority: 'low'
      },
      image_uploaded: {
        title: 'Profile Picture Updated',
        message: 'Your profile picture has been successfully updated',
        priority: 'low'
      }
    };

    const notificationData = notificationMap[type];
    if (!notificationData) {
      throw new Error(`Unknown notification type: ${type}`);
    }

    return await this.sendNotification(userId, {
      ...notificationData,
      type,
      data
    });
  }

  // Generate notification title based on type
  static generateTitle(type, data = {}) {
    const titleMap = {
      profile_updated: 'Profile Updated',
      email_changed: 'Email Changed',
      password_changed: 'Password Changed',
      wallet_added: 'Wallet Added',
      wallet_removed: 'Wallet Removed',
      profile_milestone: 'Profile Milestone!',
      achievement_unlocked: 'Achievement Unlocked!',
      security_alert: 'Security Alert',
      social_connected: 'Social Profile Connected',
      preferences_updated: 'Preferences Updated',
      image_uploaded: 'Profile Picture Updated'
    };

    return titleMap[type] || 'Notification';
  }

  // Calculate notification expiration
  static calculateExpiration(type) {
    const expirationMap = {
      profile_updated: 7, // 7 days
      email_changed: 30, // 30 days
      password_changed: 30, // 30 days
      wallet_added: 14, // 14 days
      wallet_removed: 14, // 14 days
      profile_milestone: 30, // 30 days
      achievement_unlocked: null, // Never expires
      security_alert: 60, // 60 days
      social_connected: 7, // 7 days
      preferences_updated: 3, // 3 days
      image_uploaded: 7 // 7 days
    };

    const days = expirationMap[type];
    if (days === null) return null;
    
    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + days);
    return expirationDate;
  }

  // Send email notification (placeholder - integrate with your email service)
  static async sendEmailNotification(userId, notification) {
    try {
      // Get user email
      const User = require('../models/User');
      const user = await User.findById(userId).select('email displayName preferences');
      
      if (!user || !user.email) {
        console.log('No email found for user:', userId);
        return false;
      }

      // Check if user allows email notifications
      if (!user.preferences?.notifications?.email) {
        console.log('User has disabled email notifications:', userId);
        return false;
      }

      // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
      console.log(`[EMAIL] Sending to ${user.email}:`, {
        subject: notification.title,
        body: notification.message,
        data: notification.data
      });

      // Mock email sending
      return true;
    } catch (error) {
      console.error('Failed to send email notification:', error);
      return false;
    }
  }

  // Send push notification (placeholder - integrate with your push service)
  static async sendPushNotification(userId, notification) {
    try {
      // Get user push preferences
      const User = require('../models/User');
      const user = await User.findById(userId).select('preferences');
      
      if (!user?.preferences?.notifications?.push) {
        console.log('User has disabled push notifications:', userId);
        return false;
      }

      // TODO: Integrate with push notification service (Firebase, OneSignal, etc.)
      console.log(`[PUSH] Sending to user ${userId}:`, {
        title: notification.title,
        body: notification.message,
        data: notification.data
      });

      // Mock push notification sending
      return true;
    } catch (error) {
      console.error('Failed to send push notification:', error);
      return false;
    }
  }

  // Emit real-time notification (placeholder - integrate with WebSocket)
  static async emitRealTimeNotification(userId, notification) {
    try {
      // TODO: Integrate with WebSocket/Socket.IO for real-time notifications
      console.log(`[REAL-TIME] Emitting to user ${userId}:`, {
        id: notification._id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        data: notification.data,
        priority: notification.priority,
        createdAt: notification.createdAt
      });

      // Mock real-time notification
      return true;
    } catch (error) {
      console.error('Failed to emit real-time notification:', error);
      return false;
    }
  }

  // Cleanup expired notifications
  static async cleanupExpiredNotifications() {
    try {
      const result = await Notification.deleteMany({
        expiresAt: { $lt: new Date() }
      });

      console.log(`Cleaned up ${result.deletedCount} expired notifications`);
      return result.deletedCount;
    } catch (error) {
      console.error('Failed to cleanup expired notifications:', error);
      throw new Error('Failed to cleanup expired notifications');
    }
  }

  // Get notification preferences for user
  static async getNotificationPreferences(userId) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId).select('preferences.notifications');
      
      return user?.preferences?.notifications || {
        email: true,
        push: true,
        marketing: false,
        events: true,
        tickets: true
      };
    } catch (error) {
      console.error('Failed to get notification preferences:', error);
      throw new Error('Failed to get notification preferences');
    }
  }

  // Update notification preferences for user
  static async updateNotificationPreferences(userId, preferences) {
    try {
      const User = require('../models/User');
      const user = await User.findById(userId);
      
      if (!user) {
        throw new Error('User not found');
      }

      user.preferences.notifications = {
        ...user.preferences.notifications,
        ...preferences
      };

      await user.save();

      // Send confirmation notification
      await this.sendProfileNotification(userId, 'preferences_updated', {
        preferences
      });

      return user.preferences.notifications;
    } catch (error) {
      console.error('Failed to update notification preferences:', error);
      throw new Error('Failed to update notification preferences');
    }
  }

  // Get notification templates
  static getNotificationTemplates() {
    return {
      profile_updated: {
        title: 'Profile Updated',
        message: 'Your profile information has been successfully updated.',
        icon: '👤',
        color: '#4CAF50'
      },
      email_changed: {
        title: 'Email Address Changed',
        message: 'Your email address has been updated. If this wasn\'t you, please contact support immediately.',
        icon: '📧',
        color: '#FF9800'
      },
      password_changed: {
        title: 'Password Changed',
        message: 'Your password has been successfully changed. If this wasn\'t you, please contact support immediately.',
        icon: '🔒',
        color: '#FF9800'
      },
      wallet_added: {
        title: 'Wallet Connected',
        message: 'A new wallet has been connected to your account.',
        icon: '👛',
        color: '#2196F3'
      },
      wallet_removed: {
        title: 'Wallet Removed',
        message: 'A wallet has been removed from your account.',
        icon: '💼',
        color: '#FF5722'
      },
      profile_milestone: {
        title: 'Profile Milestone!',
        message: 'Congratulations on reaching a new profile completion milestone!',
        icon: '🎉',
        color: '#9C27B0'
      },
      achievement_unlocked: {
        title: 'Achievement Unlocked!',
        message: 'You\'ve earned a new achievement!',
        icon: '🏆',
        color: '#FFC107'
      },
      security_alert: {
        title: 'Security Alert',
        message: 'Important security update for your account.',
        icon: '⚠️',
        color: '#F44336'
      },
      social_connected: {
        title: 'Social Profile Connected',
        message: 'Your social media profile has been connected.',
        icon: '🌐',
        color: '#00BCD4'
      },
      preferences_updated: {
        title: 'Preferences Updated',
        message: 'Your account preferences have been updated.',
        icon: '⚙️',
        color: '#607D8B'
      },
      image_uploaded: {
        title: 'Profile Picture Updated',
        message: 'Your profile picture has been successfully updated.',
        icon: '📸',
        color: '#795548'
      }
    };
  }
}

// Export both the service and the model
module.exports = { NotificationService, Notification };
