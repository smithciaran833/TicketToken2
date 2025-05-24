const ArtistAnalytics = require('../models/artistAnalytics');
const artistRoyaltyService = require('../services/artistRoyaltyService');

/**
 * Get royalty analytics for the current artist
 * @route GET /api/analytics/royalties
 * @access Private (Artist Only)
 */
const getRoyaltyAnalytics = async (req, res) => {
  try {
    const artistId = req.user._id;
    
    // Parse query parameters
    const { 
      summary, 
      startDate, 
      endDate, 
      collectionId, 
      eventId 
    } = req.query;
    
    // Get royalty analytics with options
    const analytics = await artistRoyaltyService.getArtistRoyaltyAnalytics(
      artistId, 
      { 
        summary: summary === 'true',
        startDate,
        endDate,
        collectionId,
        eventId
      }
    );
    
    return res.status(200).json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error getting royalty analytics:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting royalty analytics',
      error: error.message
    });
  }
};

/**
 * Sync blockchain sales data for an artist
 * @route POST /api/analytics/royalties/sync
 * @access Private (Artist Only)
 */
const syncBlockchainSales = async (req, res) => {
  try {
    const artistId = req.user._id;
    
    // Start sync process
    const syncResult = await artistRoyaltyService.syncBlockchainSalesData(artistId);
    
    return res.status(200).json({
      success: true,
      message: syncResult.message,
      data: {
        syncedSales: syncResult.syncedSales
      }
    });
  } catch (error) {
    console.error('Error syncing blockchain sales data:', error);
    return res.status(500).json({
      success: false,
      message: 'Error syncing blockchain sales data',
      error: error.message
    });
  }
};

/**
 * Generate royalty report
 * @route GET /api/analytics/royalties/report
 * @access Private (Artist Only)
 */
const generateRoyaltyReport = async (req, res) => {
  try {
    const artistId = req.user._id;
    
    // Parse query parameters
    const { 
      periodType = 'monthly',
      startDate, 
      endDate,
      includeRawData = false
    } = req.query;
    
    // Generate report
    const report = await artistRoyaltyService.generateRoyaltyReport(
      artistId,
      periodType,
      {
        startDate,
        endDate,
        includeRawData: includeRawData === 'true'
      }
    );
    
    return res.status(200).json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error generating royalty report:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating royalty report',
      error: error.message
    });
  }
};

/**
 * Get pending royalties
 * @route GET /api/analytics/royalties/pending
 * @access Private (Artist Only)
 */
const getPendingRoyalties = async (req, res) => {
  try {
    const artistId = req.user._id;
    
    // Get artist analytics
    const artistAnalytics = await ArtistAnalytics.getByArtistId(artistId);
    
    return res.status(200).json({
      success: true,
      data: {
        pendingRoyalties: artistAnalytics.pendingRoyalties,
        totalPending: artistAnalytics.pendingRoyalties.length,
        totalAmount: artistAnalytics.pendingRoyalties.reduce((sum, royalty) => sum + royalty.amount, 0)
      }
    });
  } catch (error) {
    console.error('Error getting pending royalties:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting pending royalties',
      error: error.message
    });
  }
};

/**
 * Update royalty settings
 * @route PUT /api/analytics/royalties/settings
 * @access Private (Artist Only)
 */
const updateRoyaltySettings = async (req, res) => {
  try {
    const artistId = req.user._id;
    
    // Update settings
    const result = await artistRoyaltyService.updateRoyaltySettings(artistId, req.body);
    
    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.settings
    });
  } catch (error) {
    console.error('Error updating royalty settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating royalty settings',
      error: error.message
    });
  }
};

/**
 * Get royalty settings
 * @route GET /api/analytics/royalties/settings
 * @access Private (Artist Only)
 */
const getRoyaltySettings = async (req, res) => {
  try {
    const artistId = req.user._id;
    
    // Get artist analytics
    const artistAnalytics = await ArtistAnalytics.getByArtistId(artistId);
    
    return res.status(200).json({
      success: true,
      data: artistAnalytics.platformData
    });
  } catch (error) {
    console.error('Error getting royalty settings:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting royalty settings',
      error: error.message
    });
  }
};

/**
 * Get royalty distribution for a resource
 * @route GET /api/analytics/royalties/distribution/:resourceType/:resourceId
 * @access Private (Admin or Resource Owner)
 */
const getRoyaltyDistribution = async (req, res) => {
  try {
    const { resourceType, resourceId } = req.params;
    
    // Validate resource type
    if (!['event', 'collection'].includes(resourceType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid resource type. Must be "event" or "collection".'
      });
    }
    
    // Get royalty distribution
    const distribution = await artistRoyaltyService.getRoyaltyDistribution(resourceId, resourceType);
    
    return res.status(200).json({
      success: true,
      data: distribution
    });
  } catch (error) {
    console.error('Error getting royalty distribution:', error);
    return res.status(500).json({
      success: false,
      message: 'Error getting royalty distribution',
      error: error.message
    });
  }
};

/**
 * Record a royalty payment (Admin only)
 * @route POST /api/analytics/royalties/payment
 * @access Private (Admin Only)
 */
const recordRoyaltyPayment = async (req, res) => {
  try {
    // Verify admin access
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    // Record payment
    const result = await artistRoyaltyService.recordRoyaltyPayment(req.body);
    
    return res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error recording royalty payment:', error);
    return res.status(500).json({
      success: false,
      message: 'Error recording royalty payment',
      error: error.message
    });
  }
};

/**
 * Add pending royalty (Admin only)
 * @route POST /api/analytics/royalties/pending
 * @access Private (Admin Only)
 */
const addPendingRoyalty = async (req, res) => {
  try {
    // Verify admin access
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    // Add pending royalty
    const result = await artistRoyaltyService.addPendingRoyalty(req.body);
    
    return res.status(200).json({
      success: true,
      message: result.message
    });
  } catch (error) {
    console.error('Error adding pending royalty:', error);
    return res.status(500).json({
      success: false,
      message: 'Error adding pending royalty',
      error: error.message
    });
  }
};

/**
 * Process pending royalties (Admin only)
 * @route POST /api/analytics/royalties/process-pending
 * @access Private (Admin Only)
 */
const processPendingRoyalties = async (req, res) => {
  try {
    // Verify admin access
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }
    
    const { artistId = 'all' } = req.body;
    
    // Process pending royalties
    const result = await artistRoyaltyService.scheduleBulkPayout(artistId);
    
    return res.status(200).json({
      success: true,
      message: result.message,
      data: {
        processed: result.processed
      }
    });
  } catch (error) {
    console.error('Error processing pending royalties:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing pending royalties',
      error: error.message
    });
  }
};

module.exports = {
  getRoyaltyAnalytics,
  syncBlockchainSales,
  generateRoyaltyReport,
  getPendingRoyalties,
  updateRoyaltySettings,
  getRoyaltySettings,
  getRoyaltyDistribution,
  recordRoyaltyPayment,
  addPendingRoyalty,
  processPendingRoyalties
};
