// controllers/accessController.js - Content access management

const ExclusiveContent = require('../models/ExclusiveContent');
const ContentAccess = require('../models/ContentAccess');
const Ticket = require('../models/Ticket');
const { sendSuccess, sendError, sendNotFound, sendForbidden } = require('../utils/responseHelper');

// @desc    Generate temporary access token for content
// @route   POST /api/access/token
// @access  Private
const generateAccessToken = async (req, res) => {
  try {
    const { contentId, ticketId } = req.body;
    
    if (!contentId || !ticketId) {
      return sendError(res, 'Content ID and Ticket ID are required');
    }
    
    // Find the content
    const content = await ExclusiveContent.findOne({ contentId });
    if (!content) {
      return sendNotFound(res, 'Content');
    }
    
    // Find the ticket and ensure it belongs to the user
    const ticket = await Ticket.findOne({ 
      ticketId, 
      owner: req.user._id,
      status: 'active'
    });
    
    if (!ticket) {
      return sendNotFound(res, 'Ticket');
    }
    
    // Verify ticket is for the right event
    if (ticket.event.toString() !== content.event.toString()) {
      return sendForbidden(res, 'Ticket is for a different event');
    }
    
    // Check if ticket grants access to this content
    if (!content.isAccessibleWithTicket(ticket)) {
      return sendForbidden(res, 'Ticket does not grant access to this content');
    }
    
    // Create an access record
    const access = await ContentAccess.create({
      user: req.user._id,
      content: content._id,
      ticket: ticket._id,
      accessType: req.body.accessType || 'view',
      deviceInfo: req.headers['user-agent'],
      ipAddress: req.ip
    });
    
    // Generate a JWT token for temporary access
    const jwt = require('jsonwebtoken');
    const expiresIn = '1h'; // Token valid for 1 hour
    
    const token = jwt.sign(
      {
        userId: req.user._id,
        contentId: content._id,
        ticketId: ticket._id,
        accessId: access._id,
        type: req.body.accessType || 'view'
      },
      process.env.JWT_SECRET,
      { expiresIn }
    );
    
    return sendSuccess(res, {
      token,
      expiresIn,
      content: {
        title: content.title,
        contentType: content.contentType,
        thumbnailUrl: content.thumbnailUrl
      }
    }, 'Access token generated successfully');
  } catch (error) {
    console.error('Generate access token error:', error);
    return sendError(res, 'Server error generating access token', { server: error.message }, 500);
  }
};

// @desc    Verify content access token
// @route   GET /api/access/verify
// @access  Private
const verifyAccessToken = async (req, res) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return sendError(res, 'Access token is required');
    }
    
    // Verify token
    const jwt = require('jsonwebtoken');
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return sendForbidden(res, 'Invalid or expired access token');
    }
    
    // Check if access record still exists
    const access = await ContentAccess.findById(decoded.accessId);
    if (!access) {
      return sendForbidden(res, 'Access record not found');
    }
    
    // Check if access is still valid
    if (access.status !== 'granted' || (access.expiresAt && access.expiresAt < new Date())) {
      return sendForbidden(res, 'Access has expired or been revoked');
    }
    
    // Find the content
    const content = await ExclusiveContent.findById(decoded.contentId);
    if (!content) {
      return sendNotFound(res, 'Content');
    }
    
    // Generate secure content URL with signed parameters
    const contentUrlWithAccess = generateSecureContentUrl(content, decoded);
    
    return sendSuccess(res, {
      isValid: true,
      accessType: decoded.type,
      contentUrl: contentUrlWithAccess,
      content: {
        title: content.title,
        contentType: content.contentType,
        artist: content.artist
      }
    }, 'Access token verified successfully');
  } catch (error) {
    console.error('Verify access token error:', error);
    return sendError(res, 'Server error verifying access token', { server: error.message }, 500);
  }
};

// @desc    Record content view/access
// @route   POST /api/access/record
// @access  Private
const recordContentAccess = async (req, res) => {
  try {
    const { contentId, accessType, duration } = req.body;
    
    if (!contentId) {
      return sendError(res, 'Content ID is required');
    }
    
    // Find the content
    const content = await ExclusiveContent.findOne({ contentId });
    if (!content) {
      return sendNotFound(res, 'Content');
    }
    
    // Check if user has tickets for this event
    const tickets = await Ticket.find({
      owner: req.user._id,
      event: content.event,
      status: 'active'
    });
    
    // If user is not artist/admin and has no tickets, deny access
    if (content.artist.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && 
        tickets.length === 0) {
      return sendForbidden(res, 'You need a ticket to access this content');
    }
    
    // If not artist/admin, check if tickets grant access
    if (content.artist.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      const hasAccess = tickets.some(ticket => content.isAccessibleWithTicket(ticket));
      if (!hasAccess) {
        return sendForbidden(res, 'Your tickets do not grant access to this content');
      }
    }
    
    // Create access record
    const access = await ContentAccess.create({
      user: req.user._id,
      content: content._id,
      ticket: tickets.length > 0 ? tickets[0]._id : null, // Use first ticket if available
      accessType: accessType || 'view',
      deviceInfo: req.headers['user-agent'],
      ipAddress: req.ip,
      duration: duration
    });
    
    // Increment view count
    if (accessType === 'view' || !accessType) {
      await content.incrementViews();
    }
    
    return sendSuccess(res, {
      accessId: access._id,
      contentId: content.contentId,
      accessType: access.accessType,
      accessedAt: access.accessedAt
    }, 'Content access recorded successfully');
  } catch (error) {
    console.error('Record content access error:', error);
    return sendError(res, 'Server error recording content access', { server: error.message }, 500);
  }
};

// @desc    Revoke content access
// @route   POST /api/access/revoke
// @access  Private (Admin only)
const revokeAccess = async (req, res) => {
  try {
    const { accessId, userId, contentId, reason } = req.body;
    
    // Must provide at least one identifier
    if (!accessId && !userId && !contentId) {
      return sendError(res, 'Must provide accessId, userId, or contentId');
    }
    
    // Build query
    const query = {};
    if (accessId) query._id = accessId;
    if (userId) query.user = userId;
    if (contentId) {
      const content = await ExclusiveContent.findOne({ contentId });
      if (content) {
        query.content = content._id;
      } else {
        return sendNotFound(res, 'Content');
      }
    }
    
    // Update access status to 'denied'
    const result = await ContentAccess.updateMany(
      query,
      {
        $set: {
          status: 'denied',
          metadata: {
            revokedBy: req.user._id,
            revokedAt: new Date(),
            reason: reason || 'Administrative action'
          }
        }
      }
    );
    
    if (result.modifiedCount === 0) {
      return sendNotFound(res, 'Access records');
    }
    
    return sendSuccess(res, {
      revokedCount: result.modifiedCount,
      query
    }, 'Access revoked successfully');
  } catch (error) {
    console.error('Revoke access error:', error);
    return sendError(res, 'Server error revoking access', { server: error.message }, 500);
  }
};

// @desc    Get content access statistics
// @route   GET /api/access/stats/:contentId
// @access  Private (Artists and Admins only)
const getContentAccessStats = async (req, res) => {
  try {
    const { contentId } = req.params;
    
    // Find the content
    const content = await ExclusiveContent.findOne({ contentId })
      .populate('artist', 'displayName username _id');
    
    if (!content) {
      return sendNotFound(res, 'Content');
    }
    
    // Check if user is authorized to view stats (artist or admin)
    if (content.artist._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return sendForbidden(res, 'Only the content creator or admin can view these stats');
    }
    
    // Get basic stats
    const totalAccesses = await ContentAccess.countDocuments({ content: content._id });
    const uniqueUsers = await ContentAccess.distinct('user', { content: content._id }).then(users => users.length);
    
    // Get access by type
    const accessTypeStats = await ContentAccess.aggregate([
      { $match: { content: content._id } },
      { $group: { _id: '$accessType', count: { $sum: 1 } } }
    ]);
    
    // Get access over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const dailyStats = await ContentAccess.aggregate([
      { 
        $match: { 
          content: content._id,
          accessedAt: { $gte: thirtyDaysAgo }
        } 
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: '%Y-%m-%d', date: '$accessedAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Format stats
    const formattedStats = {
      content: {
        id: content.contentId,
        title: content.title,
        type: content.contentType,
        views: content.views
      },
      accessStats: {
        totalAccesses,
        uniqueUsers,
        byType: accessTypeStats.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {})
      },
      dailyStats: dailyStats.map(day => ({
        date: day._id,
        count: day.count
      }))
    };
    
    return sendSuccess(res, formattedStats, 'Content access statistics retrieved successfully');
  } catch (error) {
    console.error('Get content access stats error:', error);
    return sendError(res, 'Server error retrieving access stats', { server: error.message }, 500);
  }
};

// Helper function to generate secure content URL
function generateSecureContentUrl(content, decodedToken) {
  const crypto = require('crypto');
  
  // Create a signature using contentId, userId, and timestamp
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update(`${content.contentId}-${decodedToken.userId}-${timestamp}`)
    .digest('hex');
  
  // Build the URL with authentication parameters
  const baseUrl = content.contentUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  
  return `${baseUrl}${separator}access_token=${decodedToken.accessId}&user=${decodedToken.userId}&ts=${timestamp}&sig=${signature}`;
}

module.exports = {
  generateAccessToken,
  verifyAccessToken,
  recordContentAccess,
  revokeAccess,
  getContentAccessStats
};
