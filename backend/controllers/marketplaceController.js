// controllers/marketplaceController.js - Marketplace controller

const marketplaceService = require('../services/marketplaceService');
const { sendSuccess, sendError, sendNotFound } = require('../utils/responseHelper');

/**
 * @desc    Create a new listing
 * @route   POST /api/marketplace/listings
 * @access  Private
 */
const createListing = async (req, res) => {
  try {
    const result = await marketplaceService.createListing(req.body, req.user._id);
    return sendSuccess(res, result, 'Listing created successfully', 201);
  } catch (error) {
    console.error('Create listing error:', error);
    return sendError(res, 'Failed to create listing', { error: error.message }, 400);
  }
};

/**
 * @desc    Get all active listings
 * @route   GET /api/marketplace/listings
 * @access  Private
 */
const getListings = async (req, res) => {
  try {
    const result = await marketplaceService.getActiveListings(req.query);
    return sendSuccess(res, result, 'Listings retrieved successfully');
  } catch (error) {
    console.error('Get listings error:', error);
    return sendError(res, 'Failed to retrieve listings', { error: error.message }, 500);
  }
};

/**
 * @desc    Get listing details
 * @route   GET /api/marketplace/listings/:id
 * @access  Private
 */
const getListingById = async (req, res) => {
  try {
    const listing = await marketplaceService.getListingDetails(req.params.id);
    
    if (!listing) {
      return sendNotFound(res, 'Listing');
    }
    
    return sendSuccess(res, { listing }, 'Listing retrieved successfully');
  } catch (error) {
    console.error('Get listing error:', error);
    return sendError(res, 'Failed to retrieve listing', { error: error.message }, 500);
  }
};

/**
 * @desc    Cancel a listing
 * @route   DELETE /api/marketplace/listings/:id
 * @access  Private
 */
const cancelListing = async (req, res) => {
  try {
    const result = await marketplaceService.cancelListing(req.params.id, req.user._id);
    return sendSuccess(res, result, 'Listing cancelled successfully');
  } catch (error) {
    console.error('Cancel listing error:', error);
    return sendError(res, 'Failed to cancel listing', { error: error.message }, 400);
  }
};

/**
 * @desc    Purchase a listed ticket
 * @route   POST /api/marketplace/purchase/:listingId
 * @access  Private
 */
const purchaseListing = async (req, res) => {
  try {
    const { paymentMethod } = req.body;
    const result = await marketplaceService.purchaseListing(
      req.params.listingId,
      req.user._id,
      paymentMethod
    );
    
    return sendSuccess(res, result, 'Ticket purchased successfully');
  } catch (error) {
    console.error('Purchase listing error:', error);
    return sendError(res, 'Failed to purchase ticket', { error: error.message }, 400);
  }
};

/**
 * @desc    Get marketplace statistics
 * @route   GET /api/marketplace/stats
 * @access  Private
 */
const getMarketplaceStats = async (req, res) => {
  try {
    const stats = await marketplaceService.getMarketplaceStats();
    return sendSuccess(res, stats, 'Marketplace statistics retrieved successfully');
  } catch (error) {
    console.error('Get marketplace stats error:', error);
    return sendError(res, 'Failed to retrieve marketplace statistics', { error: error.message }, 500);
  }
};

/**
 * @desc    Get marketplace statistics for an event
 * @route   GET /api/marketplace/stats/event/:eventId
 * @access  Private
 */
const getEventMarketplaceStats = async (req, res) => {
  try {
    const stats = await marketplaceService.getMarketplaceStats(req.params.eventId);
    return sendSuccess(res, stats, 'Event marketplace statistics retrieved successfully');
  } catch (error) {
    console.error('Get event marketplace stats error:', error);
    return sendError(res, 'Failed to retrieve event marketplace statistics', { error: error.message }, 500);
  }
};

module.exports = {
  createListing,
  getListings,
  getListingById,
  cancelListing,
  purchaseListing,
  getMarketplaceStats,
  getEventMarketplaceStats
};
