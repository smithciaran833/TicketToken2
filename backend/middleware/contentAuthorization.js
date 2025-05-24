// middleware/contentAuthorization.js - Authorization for content access

const ExclusiveContent = require('../models/ExclusiveContent');
const Ticket = require('../models/Ticket');
const { sendForbidden, sendNotFound } = require('../utils/responseHelper');

/**
 * Middleware to check if user has access to the content
 * Can be used for both content routes and direct file access
 */
const validateContentAccess = async (req, res, next) => {
  try {
    // Get content ID from params or query
    const contentId = req.params.id || req.query.contentId;
    
    if (!contentId) {
      return sendForbidden(res, 'Content ID is required');
    }
    
    // Find the content
    const content = await ExclusiveContent.findOne({ contentId });
    
    if (!content) {
      return sendNotFound(res, 'Content');
    }
    
    // Add content to request for downstream middleware
    req.content = content;
    
    // If user is admin or the content creator, grant access
    if (req.user.role === 'admin' || content.artist.toString() === req.user._id.toString()) {
      return next();
    }
    
    // Check if content is published
    if (content.status !== 'published') {
      return sendForbidden(res, 'This content is not published');
    }
    
    // Check availability window
    const now = new Date();
    if (content.availableFrom && content.availableFrom > now) {
      return sendForbidden(res, 'This content is not available yet');
    }
    
    if (content.availableUntil && content.availableUntil < now) {
      return sendForbidden(res, 'This content is no longer available');
    }
    
    // Free content is accessible to all authenticated users
    if (content.accessLevel === 'free') {
      return next();
    }
    
    // Check if user has a ticket for this event
    const tickets = await Ticket.find({
      owner: req.user._id,
      event: content.event,
      status: 'active'
    });
    
    if (tickets.length === 0) {
      return sendForbidden(res, 'You need a ticket to access this content');
    }
    
    // Check if any tickets grant access
    const hasAccess = tickets.some(ticket => content.isAccessibleWithTicket(ticket));
    
    if (!hasAccess) {
      return sendForbidden(res, 'Your ticket type does not grant access to this content');
    }
    
    // Store the ticket used for access in the request
    req.accessTicket = tickets.find(ticket => content.isAccessibleWithTicket(ticket));
    
    // Access granted
    next();
  } catch (error) {
    console.error('Content access validation error:', error);
    return sendForbidden(res, 'Error validating content access');
  }
};

/**
 * Middleware to check if user can modify the content
 */
const validateContentOwnership = async (req, res, next) => {
  try {
    // Get content ID from params
    const contentId = req.params.id;
    
    if (!contentId) {
      return sendForbidden(res, 'Content ID is required');
    }
    
    // Find the content
    const content = await ExclusiveContent.findOne({ contentId });
    
    if (!content) {
      return sendNotFound(res, 'Content');
    }
    
    // Add content to request for downstream middleware
    req.content = content;
    
    // If user is admin or the content creator, grant access
    if (req.user.role === 'admin' || content.artist.toString() === req.user._id.toString()) {
      return next();
    }
    
    return sendForbidden(res, 'You do not have permission to modify this content');
  } catch (error) {
    console.error('Content ownership validation error:', error);
    return sendForbidden(res, 'Error validating content ownership');
  }
};

/**
 * Middleware to check if user is an artist or admin
 */
const requireArtistRole = (req, res, next) => {
  if (req.user.role === 'admin' || req.user.role === 'organizer') {
    return next();
  }
  
  return sendForbidden(res, 'Only artists and admins can perform this action');
};

/**
 * Middleware to parse access token from header, query or cookie
 */
const parseAccessToken = (req, res, next) => {
  // Check in authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    req.accessToken = authHeader.substring(7);
    return next();
  }
  
  // Check in query parameter
  if (req.query.access_token) {
    req.accessToken = req.query.access_token;
    return next();
  }
  
  // Check in cookie
  if (req.cookies && req.cookies.access_token) {
    req.accessToken = req.cookies.access_token;
    return next();
  }
  
  // No token found
  next();
};

/**
 * Track content access and record analytics
 */
const trackContentAccess = async (req, res, next) => {
  // Skip tracking for non-GET requests or if content is missing
  if (req.method !== 'GET' || !req.content) {
    return next();
  }
  
  try {
    const ContentAccess = require('../models/ContentAccess');
    
    // Create access record asynchronously (don't wait for it)
    ContentAccess.create({
      user: req.user._id,
      content: req.content._id,
      ticket: req.accessTicket ? req.accessTicket._id : null,
      accessType: 'view',
      deviceInfo: req.headers['user-agent'],
      ipAddress: req.ip
    }).catch(err => console.error('Error recording content access:', err));
    
    // Increment view count asynchronously
    req.content.incrementViews().catch(err => console.error('Error incrementing views:', err));
    
    next();
  } catch (error) {
    // Don't fail the request if tracking fails
    console.error('Track content access error:', error);
    next();
  }
};

module.exports = {
  validateContentAccess,
  validateContentOwnership,
  requireArtistRole,
  parseAccessToken,
  trackContentAccess
};
