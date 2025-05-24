const ArtistAnalytics = require('../models/artistAnalytics');
const Event = require('../models/event'); // Assuming you have an Event model
const User = require('../models/User'); // Assuming you have a User model
const Collection = require('../models/collection'); // Assuming you have a Collection model
const axios = require('axios');

/**
 * Service for tracking and managing artist royalties
 */
const artistRoyaltyService = {
  /**
   * Record a new royalty payment for an artist
   * @param {Object} paymentData - Data about the royalty payment
   * @returns {Promise<Object>} - Updated artist analytics
   */
  recordRoyaltyPayment: async (paymentData) => {
    try {
      // Validate required fields
      if (!paymentData.artistId || !paymentData.amount || !paymentData.transactionId) {
        throw new Error('Missing required fields for royalty payment');
      }
      
      // Get artist analytics document
      const artistAnalytics = await ArtistAnalytics.getByArtistId(paymentData.artistId);
      
      // Check if payment already exists to avoid duplicates
      const existingPayment = artistAnalytics.paymentRecords.find(
        record => record.transactionId === paymentData.transactionId
      );
      
      if (existingPayment) {
        return { success: false, message: 'Payment already recorded', analytics: artistAnalytics };
      }
      
      // Set defaults if not provided
      if (!paymentData.date) {
        paymentData.date = new Date();
      }
      
      if (!paymentData.saleType) {
        paymentData.saleType = 'secondary'; // Default to secondary sale for royalties
      }
      
      if (!paymentData.status) {
        paymentData.status = 'completed';
      }
      
      // Record the payment
      await artistAnalytics.addRoyaltyPayment(paymentData);
      
      // If this payment was in pending royalties, remove it
      if (paymentData.saleId) {
        await artistAnalytics.removePendingRoyalty(paymentData.saleId);
      }
      
      return { 
        success: true, 
        message: 'Royalty payment recorded successfully',
        analytics: artistAnalytics
      };
    } catch (error) {
      console.error('Error recording royalty payment:', error);
      throw error;
    }
  },
  
  /**
   * Add a pending royalty payment
   * @param {Object} pendingData - Data about the pending royalty
   * @returns {Promise<Object>} - Updated artist analytics
   */
  addPendingRoyalty: async (pendingData) => {
    try {
      // Validate required fields
      if (!pendingData.artistId || !pendingData.amount || !pendingData.saleId) {
        throw new Error('Missing required fields for pending royalty');
      }
      
      // Get artist analytics document
      const artistAnalytics = await ArtistAnalytics.getByArtistId(pendingData.artistId);
      
      // Check if pending royalty already exists
      const existingPending = artistAnalytics.pendingRoyalties.find(
        pending => pending.saleId === pendingData.saleId
      );
      
      if (existingPending) {
        return { success: false, message: 'Pending royalty already exists', analytics: artistAnalytics };
      }
      
      // Set defaults if not provided
      if (!pendingData.date) {
        pendingData.date = new Date();
      }
      
      // Set estimated payment date if not provided (default to 7 days from now)
      if (!pendingData.estimatedPaymentDate) {
        const estimatedDate = new Date();
        estimatedDate.setDate(estimatedDate.getDate() + 7);
        pendingData.estimatedPaymentDate = estimatedDate;
      }
      
      // Add to pending royalties
      artistAnalytics.pendingRoyalties.push(pendingData);
      
      // Update last updated timestamp
      artistAnalytics.lastUpdated = new Date();
      
      await artistAnalytics.save();
      
      return { 
        success: true, 
        message: 'Pending royalty added successfully',
        analytics: artistAnalytics
      };
    } catch (error) {
      console.error('Error adding pending royalty:', error);
      throw error;
    }
  },
  
  /**
   * Get royalty analytics for an artist
   * @param {String} artistId - Artist's user ID
   * @param {Object} options - Options for filtering and data selection
   * @returns {Promise<Object>} - Artist royalty analytics
   */
  getArtistRoyaltyAnalytics: async (artistId, options = {}) => {
    try {
      // Get artist analytics document
      const artistAnalytics = await ArtistAnalytics.getByArtistId(artistId);
      
      // If summary requested, return only summary data
      if (options.summary) {
        return artistAnalytics.getSummary();
      }
      
      // Filter by date range if provided
      if (options.startDate || options.endDate) {
        const filteredData = {
          ...artistAnalytics.toObject(),
          paymentRecords: []
        };
        
        const startDate = options.startDate ? new Date(options.startDate) : new Date(0);
        const endDate = options.endDate ? new Date(options.endDate) : new Date();
        
        // Filter payment records
        filteredData.paymentRecords = artistAnalytics.paymentRecords.filter(record => {
          const recordDate = new Date(record.date);
          return recordDate >= startDate && recordDate <= endDate;
        });
        
        return filteredData;
      }
      
      // Filter by collection if provided
      if (options.collectionId) {
        const filteredData = {
          ...artistAnalytics.toObject(),
          paymentRecords: [],
          royaltiesByCollection: []
        };
        
        // Filter payment records
        filteredData.paymentRecords = artistAnalytics.paymentRecords.filter(record => {
          return record.collectionId && 
                 record.collectionId.toString() === options.collectionId.toString();
        });
        
        // Filter collection data
        filteredData.royaltiesByCollection = artistAnalytics.royaltiesByCollection.filter(collection => {
          return collection.collectionId.toString() === options.collectionId.toString();
        });
        
        return filteredData;
      }
      
      // Filter by event if provided
      if (options.eventId) {
        const filteredData = {
          ...artistAnalytics.toObject(),
          paymentRecords: [],
          royaltiesByCollection: []
        };
        
        // Filter payment records
        filteredData.paymentRecords = artistAnalytics.paymentRecords.filter(record => {
          return record.eventId && 
                 record.eventId.toString() === options.eventId.toString();
        });
        
        // Filter collection data
        filteredData.royaltiesByCollection = artistAnalytics.royaltiesByCollection.filter(collection => {
          return collection.eventId.toString() === options.eventId.toString();
        });
        
        return filteredData;
      }
      
      // Return full analytics data
      return artistAnalytics;
    } catch (error) {
      console.error('Error getting artist royalty analytics:', error);
      throw error;
    }
  },
  
  /**
   * Sync blockchain sales data with artist analytics
   * @param {String} artistId - Artist's user ID
   * @param {Object} options - Syncing options
   * @returns {Promise<Object>} - Sync results
   */
  syncBlockchainSalesData: async (artistId, options = {}) => {
    try {
      // Get artist analytics document
      const artistAnalytics = await ArtistAnalytics.getByArtistId(artistId);
      
      // Get artist's collections or events
      const collections = await Collection.find({ artistId });
      const events = await Event.find({ artistId });
      
      // Get artist wallet addresses from user profile
      const artist = await User.findById(artistId).select('wallets');
      const walletAddresses = artist?.wallets || [];
      
      if (!walletAddresses.length) {
        return { 
          success: false, 
          message: 'No wallet addresses found for artist',
          syncedSales: 0
        };
      }
      
      // Get the last sync time or default to 30 days ago
      const lastSyncedWithBlockchain = artistAnalytics.lastSyncedWithBlockchain || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      // Prepare contract addresses for marketplaces
      const contractAddresses = collections.map(collection => collection.contractAddress).filter(Boolean);
      
      let syncedSales = 0;
      
      // Sync data from each blockchain marketplace
      // This would ideally use marketplace-specific APIs or subgraphs
      
      // Example: Sync from OpenSea (would require API key in production)
      if (contractAddresses.length > 0) {
        try {
          // This is a placeholder for actual API call in production
          // const openSeaResponse = await axios.get(
          //   `https://api.opensea.io/api/v1/events`,
          //   {
          //     params: {
          //       asset_contract_address: contractAddresses.join(','),
          //       event_type: 'successful',
          //       occurred_after: Math.floor(lastSyncedWithBlockchain.getTime() / 1000)
          //     },
          //     headers: {
          //       'X-API-KEY': process.env.OPENSEA_API_KEY
          //     }
          //   }
          // );
          
          // Mock response for development
          const openSeaResponse = {
            data: {
              asset_events: [
                // Sample sales data would go here in production
              ]
            }
          };
          
          // Process sales data
          for (const event of openSeaResponse.data.asset_events || []) {
            // Check if this sale is already recorded
            const existingPayment = artistAnalytics.paymentRecords.find(
              record => record.transactionId === `opensea-${event.id}`
            );
            
            if (existingPayment) {
              continue; // Skip if already recorded
            }
            
            // Calculate royalty amount
            const royaltyPercentage = 5; // Get from collection config in production
            const salePrice = parseFloat(event.total_price) / (10 ** 18); // Convert from wei to ETH
            const royaltyAmount = salePrice * (royaltyPercentage / 100);
            
            // Record the royalty payment
            await artistRoyaltyService.recordRoyaltyPayment({
              artistId,
              transactionId: `opensea-${event.id}`,
              date: new Date(event.created_date),
              amount: royaltyAmount,
              currency: 'ETH',
              paymentType: 'crypto',
              tokenId: event.asset.token_id,
              buyerAddress: event.winner_account.address,
              sellerAddress: event.seller.address,
              marketplace: 'OpenSea',
              collectionId: collections.find(c => 
                c.contractAddress.toLowerCase() === event.asset.asset_contract.address.toLowerCase()
              )?._id,
              status: 'completed',
              saleType: 'secondary',
              royaltyPercentage,
              txHash: event.transaction.transaction_hash
            });
            
            syncedSales++;
          }
        } catch (error) {
          console.error('Error syncing OpenSea data:', error);
          // Continue with other marketplaces even if one fails
        }
      }
      
      // Example: Sync from LooksRare
      if (contractAddresses.length > 0) {
        try {
          // This is a placeholder for actual API call in production
          // const looksRareResponse = await axios.get(
          //   `https://api.looksrare.org/api/v1/events`,
          //   {
          //     params: {
          //       collection: contractAddresses,
          //       type: 'SALE',
          //       from: Math.floor(lastSyncedWithBlockchain.getTime() / 1000)
          //     }
          //   }
          // );
          
          // Mock response for development
          const looksRareResponse = {
            data: {
              data: [
                // Sample sales data would go here in production
              ]
            }
          };
          
          // Process sales data
          for (const event of looksRareResponse.data.data || []) {
            // Similar processing as OpenSea
            syncedSales++;
          }
        } catch (error) {
          console.error('Error syncing LooksRare data:', error);
        }
      }
      
      // Example: Sync from Rarible
      if (contractAddresses.length > 0) {
        try {
          // Similar implementation as above marketplaces
          syncedSales += 0; // Update with actual count in production
        } catch (error) {
          console.error('Error syncing Rarible data:', error);
        }
      }
      
      // Update last sync time
      artistAnalytics.lastSyncedWithBlockchain = new Date();
      await artistAnalytics.save();
      
      return {
        success: true,
        message: `Successfully synced ${syncedSales} sales from blockchain marketplaces`,
        syncedSales
      };
    } catch (error) {
      console.error('Error syncing blockchain sales data:', error);
      throw error;
    }
  },
  
  /**
   * Generate royalty reports for an artist
   * @param {String} artistId - Artist's user ID
   * @param {String} periodType - Report period type (daily, weekly, monthly, yearly)
   * @param {Object} options - Report options
   * @returns {Promise<Object>} - Generated report
   */
  generateRoyaltyReport: async (artistId, periodType = 'monthly', options = {}) => {
    try {
      // Get artist analytics document
      const artistAnalytics = await ArtistAnalytics.getByArtistId(artistId);
      
      // Define date range for report
      let startDate, endDate;
      
      if (options.startDate && options.endDate) {
        startDate = new Date(options.startDate);
        endDate = new Date(options.endDate);
      } else {
        // Default to last 30 days if no date range provided
        endDate = new Date();
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
      }
      
      // Filter payment records by date range
      const paymentsInRange = artistAnalytics.paymentRecords.filter(record => {
        const recordDate = new Date(record.date);
        return recordDate >= startDate && recordDate <= endDate;
      });
      
      // Generate report based on period type
      let reportData;
      
      switch (periodType) {
        case 'daily':
          reportData = artistAnalytics.royaltiesByPeriod.daily.filter(day => {
            return day.date >= startDate && day.date <= endDate;
          });
          break;
        
        case 'weekly':
          reportData = artistAnalytics.royaltiesByPeriod.weekly.filter(week => {
            return week.weekStart >= startDate && week.weekStart <= endDate;
          });
          break;
        
        case 'monthly':
          reportData = artistAnalytics.royaltiesByPeriod.monthly.filter(month => {
            const monthDate = new Date(month.year, month.month - 1, 1);
            return monthDate >= startDate && monthDate <= endDate;
          });
          break;
        
        case 'yearly':
          reportData = artistAnalytics.royaltiesByPeriod.yearly.filter(year => {
            const yearDate = new Date(year.year, 0, 1);
            return yearDate >= startDate && yearDate <= endDate;
          });
          break;
        
        default:
          reportData = artistAnalytics.royaltiesByPeriod.monthly.filter(month => {
            const monthDate = new Date(month.year, month.month - 1, 1);
            return monthDate >= startDate && monthDate <= endDate;
          });
      }
      
      // Calculate summary statistics
      const totalRoyalties = paymentsInRange.reduce((sum, payment) => {
        return payment.saleType === 'secondary' ? sum + payment.amount : sum;
      }, 0);
      
      const totalSales = paymentsInRange.length;
      
      const marketplacesBreakdown = {};
      paymentsInRange.forEach(payment => {
        const marketplace = payment.marketplace || 'Unknown';
        if (!marketplacesBreakdown[marketplace]) {
          marketplacesBreakdown[marketplace] = {
            amount: 0,
            count: 0
          };
        }
        marketplacesBreakdown[marketplace].amount += payment.amount;
        marketplacesBreakdown[marketplace].count += 1;
      });
      
      // Generate collections breakdown
      const collectionsBreakdown = {};
      paymentsInRange.forEach(payment => {
        if (!payment.collectionId) return;
        
        const collectionId = payment.collectionId.toString();
        if (!collectionsBreakdown[collectionId]) {
          const collection = artistAnalytics.royaltiesByCollection.find(c => 
            c.collectionId.toString() === collectionId
          );
          
          collectionsBreakdown[collectionId] = {
            name: collection?.name || 'Unknown Collection',
            amount: 0,
            count: 0
          };
        }
        
        collectionsBreakdown[collectionId].amount += payment.amount;
        collectionsBreakdown[collectionId].count += 1;
      });
      
      // Return compiled report
      return {
        artistId,
        reportType: periodType,
        startDate,
        endDate,
        generatedAt: new Date(),
        summary: {
          totalRoyalties,
          totalSales,
          primarySalesCount: paymentsInRange.filter(p => p.saleType === 'primary').length,
          secondarySalesCount: paymentsInRange.filter(p => p.saleType === 'secondary').length
        },
        periodData: reportData,
        marketplacesBreakdown,
        collectionsBreakdown,
        // Include raw data if requested
        payments: options.includeRawData ? paymentsInRange : undefined
      };
    } catch (error) {
      console.error('Error generating royalty report:', error);
      throw error;
    }
  },
  
  /**
   * Update royalty settings for an artist
   * @param {String} artistId - Artist's user ID
   * @param {Object} settings - New royalty settings
   * @returns {Promise<Object>} - Updated settings
   */
  updateRoyaltySettings: async (artistId, settings) => {
    try {
      // Get artist analytics document
      const artistAnalytics = await ArtistAnalytics.getByArtistId(artistId);
      
      // Update platform data settings
      if (settings.royaltyEnforcement !== undefined) {
        artistAnalytics.platformData.royaltyEnforcement = settings.royaltyEnforcement;
      }
      
      if (settings.defaultRoyaltyPercentage !== undefined) {
        artistAnalytics.platformData.defaultRoyaltyPercentage = settings.defaultRoyaltyPercentage;
      }
      
      if (settings.payoutMethod !== undefined) {
        artistAnalytics.platformData.payoutMethod = settings.payoutMethod;
      }
      
      if (settings.payoutFrequency !== undefined) {
        artistAnalytics.platformData.payoutFrequency = settings.payoutFrequency;
      }
      
      if (settings.preferredWallet !== undefined) {
        artistAnalytics.platformData.preferredWallet = settings.preferredWallet;
      }
      
      if (settings.taxInformation) {
        artistAnalytics.platformData.taxInformation = {
          ...artistAnalytics.platformData.taxInformation,
          ...settings.taxInformation
        };
      }
      
      // Save updates
      await artistAnalytics.save();
      
      return {
        success: true,
        message: 'Royalty settings updated successfully',
        settings: artistAnalytics.platformData
      };
    } catch (error) {
      console.error('Error updating royalty settings:', error);
      throw error;
    }
  },
  
  /**
   * Get royalty distribution data for an event or collection
   * @param {String} resourceId - Event or collection ID
   * @param {String} resourceType - Type of resource ('event' or 'collection')
   * @returns {Promise<Object>} - Royalty distribution data
   */
  getRoyaltyDistribution: async (resourceId, resourceType = 'collection') => {
    try {
      let query;
      
      if (resourceType === 'event') {
        query = { 'royaltiesByCollection.eventId': resourceId };
      } else {
        query = { 'royaltiesByCollection.collectionId': resourceId };
      }
      
      // Find all artists who have royalties for this resource
      const artistAnalytics = await ArtistAnalytics.find(query);
      
      const distributionData = [];
      
      // Compile distribution data
      for (const analytics of artistAnalytics) {
        const collectionData = analytics.royaltiesByCollection.find(c => {
          if (resourceType === 'event') {
            return c.eventId.toString() === resourceId.toString();
          } else {
            return c.collectionId.toString() === resourceId.toString();
          }
        });
        
        if (collectionData) {
          // Get artist info
          const artist = await User.findById(analytics.artistId).select('username name');
          
          distributionData.push({
            artistId: analytics.artistId,
            artistName: artist?.name || artist?.username || 'Unknown Artist',
            totalEarned: collectionData.totalEarned,
            salesCount: collectionData.salesCount,
            royaltyPercentage: collectionData.royaltyPercentage,
            timeSeriesData: collectionData.timeSeriesData
          });
        }
      }
      
      return {
        resourceId,
        resourceType,
        distributionData,
        totalArtists: distributionData.length,
        totalRoyalties: distributionData.reduce((sum, data) => sum + data.totalEarned, 0),
        totalSales: distributionData.reduce((sum, data) => sum + data.salesCount, 0)
      };
    } catch (error) {
      console.error('Error getting royalty distribution:', error);
      throw error;
    }
  },
  
  /**
   * Schedule a bulk payout for pending royalties
   * @param {String} artistId - Artist's user ID or 'all' for all artists
   * @returns {Promise<Object>} - Payout results
   */
  scheduleBulkPayout: async (artistId = 'all') => {
    try {
      let artistAnalytics;
      
      if (artistId === 'all') {
        // Get all artists with pending royalties
        artistAnalytics = await ArtistAnalytics.find({
          'pendingRoyalties.0': { $exists: true }
        });
      } else {
        // Get specific artist
        const analytics = await ArtistAnalytics.getByArtistId(artistId);
        if (analytics.pendingRoyalties.length > 0) {
          artistAnalytics = [analytics];
        } else {
          artistAnalytics = [];
        }
      }
      
      if (artistAnalytics.length === 0) {
        return {
          success: true,
          message: 'No pending royalties to process',
          processed: 0
        };
      }
      
      let totalProcessed = 0;
      
      // Process each artist's pending royalties
      for (const analytics of artistAnalytics) {
        const artist = await User.findById(analytics.artistId);
        
        if (!artist) {
          console.error(`Artist not found for ID: ${analytics.artistId}`);
          continue;
        }
        
        // Get preferred wallet or use first available
        const preferredWallet = analytics.platformData.preferredWallet || 
                               (artist.wallets && artist.wallets.length > 0 ? 
                                artist.wallets[0] : null);
        
        if (!preferredWallet) {
          console.error(`No wallet found for artist: ${analytics.artistId}`);
          continue;
        }
        
        // Process each pending royalty
        for (const pendingRoyalty of [...analytics.pendingRoyalties]) {
          // In production, this would integrate with a payment processor
          // For now, we'll simulate successful payments
          
          // Record the payment
          await artistRoyaltyService.recordRoyaltyPayment({
            artistId: analytics.artistId,
            transactionId: `payout-${pendingRoyalty.saleId}`,
            date: new Date(),
            amount: pendingRoyalty.amount,
            currency: 'ETH', // This would be dynamic in production
            paymentType: 'crypto',
            tokenId: pendingRoyalty.tokenId,
            marketplace: pendingRoyalty.marketplace,
            eventId: pendingRoyalty.eventId,
            collectionId: pendingRoyalty.collectionId,
            status: 'completed',
            saleType: 'secondary',
            saleId: pendingRoyalty.saleId
          });
          
          totalProcessed++;
        }
      }
      
      return {
        success: true,
        message: `Successfully processed ${totalProcessed} pending royalties`,
        processed: totalProcessed
      };
    } catch (error) {
      console.error('Error scheduling bulk payout:', error);
      throw error;
    }
  }
};

module.exports = artistRoyaltyService;
