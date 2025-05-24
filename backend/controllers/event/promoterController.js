// ==========================================
// FILE: backend/controllers/event/promoterController.js
// ==========================================

const User = require('../../models/User');
const Event = require('../../models/Event');
const Promoter = require('../../models/Promoter');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');
const redis = require('redis');

// Redis client setup
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));
redisClient.connect().catch(console.error);

/**
 * @desc    Apply for promoter verification
 * @route   POST /api/events/promoters/apply
 * @access  Private
 * @returns {Object} Application status
 */
exports.applyForPromoter = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const {
      companyName,
      businessType,
      taxId,
      website,
      socialMedia,
      experience,
      eventHistory,
      references,
      documents
    } = req.body;

    // Check if user already has a promoter profile
    const existingPromoter = await Promoter.findOne({ user: req.user.id });
    if (existingPromoter) {
      return next(new AppError('Promoter application already exists', 400));
    }

    // Validate documents
    if (!documents || documents.length === 0) {
      return next(new AppError('Business verification documents are required', 400));
    }

    // Create promoter profile
    const promoter = await Promoter.create([{
      user: req.user.id,
      companyName,
      businessType: businessType || 'individual',
      taxId,
      website,
      socialMedia: socialMedia || {},
      experience: experience || '',
      eventHistory: eventHistory || [],
      references: references || [],
      documents,
      verification: {
        status: 'pending',
        submittedAt: new Date(),
        documents: documents.map(doc => ({
          type: doc.type,
          url: doc.url,
          status: 'pending'
        }))
      },
      settings: {
        eventCreationLimit: 5, // Initial limit
        requiresApproval: true,
        payoutSchedule: 'weekly',
        revenueShare: {
          platform: 0.15, // 15% platform fee
          promoter: 0.85
        }
      },
      analytics: {
        totalEvents: 0,
        totalTicketsSold: 0,
        totalRevenue: 0,
        averageRating: 0
      }
    }], { session });

    // Update user role
    await User.findByIdAndUpdate(
      req.user.id,
      { 
        role: 'promoter',
        promoterProfile: promoter[0]._id
      },
      { session }
    );

    await session.commitTransaction();

    // Send verification email
    logger.info('Promoter application submitted', {
      promoterId: promoter[0]._id,
      userId: req.user.id,
      companyName,
      correlationId: req.correlationId
    });

    res.status(201).json({
      success: true,
      data: {
        id: promoter[0]._id,
        status: 'pending',
        message: 'Your promoter application has been submitted for review. You will be notified within 48 hours.'
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    await session.abortTransaction();
    logger.error('Promoter application failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get promoter profile
 * @route   GET /api/events/promoters/profile
 * @access  Private/Promoter
 * @returns {Object} Promoter profile data
 */
exports.getPromoterProfile = async (req, res, next) => {
  try {
    const cacheKey = `promoter:profile:${req.user.id}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const promoter = await Promoter.findOne({ user: req.user.id })
      .populate('user', 'name email avatar')
      .populate('teamMembers.user', 'name email role')
      .lean();

    if (!promoter) {
      return next(new AppError('Promoter profile not found', 404));
    }

    // Get recent events
    const recentEvents = await Event.find({ organizer: req.user.id })
      .select('title slug status startDate ticketTypes analytics')
      .sort('-createdAt')
      .limit(10)
      .lean();

    // Calculate performance metrics
    const performanceMetrics = await calculatePromoterMetrics(req.user.id);

    const response = {
      success: true,
      data: {
        ...promoter,
        recentEvents,
        performanceMetrics
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    };

    // Cache for 5 minutes
    await redisClient.setEx(cacheKey, 300, JSON.stringify(response));

    res.json(response);

  } catch (error) {
    logger.error('Get promoter profile failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Update promoter profile
 * @route   PUT /api/events/promoters/profile
 * @access  Private/Promoter
 * @returns {Object} Updated promoter profile
 */
exports.updatePromoterProfile = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    const promoter = await Promoter.findOne({ user: req.user.id });

    if (!promoter) {
      return next(new AppError('Promoter profile not found', 404));
    }

    const allowedUpdates = [
      'companyName', 'website', 'socialMedia', 'description',
      'contactInfo', 'bankingInfo'
    ];

    // Restrict certain updates if not verified
    if (promoter.verification.status !== 'verified') {
      const restrictedFields = ['companyName', 'taxId', 'businessType'];
      const hasRestrictedUpdate = restrictedFields.some(field => req.body[field]);
      
      if (hasRestrictedUpdate) {
        return next(new AppError('Cannot update company details until verified', 400));
      }
    }

    // Apply updates
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        promoter[key] = req.body[key];
      }
    });

    await promoter.save();

    // Clear cache
    await redisClient.del(`promoter:profile:${req.user.id}`);

    logger.info('Promoter profile updated', {
      promoterId: promoter._id,
      updates: Object.keys(req.body),
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: promoter,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Promoter profile update failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get promoter events with analytics
 * @route   GET /api/events/promoters/events
 * @access  Private/Promoter
 * @returns {Object} Promoter events list
 */
exports.getPromoterEvents = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      sortBy = '-createdAt'
    } = req.query;

    const query = { organizer: req.user.id };

    if (status) query.status = status;
    if (startDate || endDate) {
      query.startDate = {};
      if (startDate) query.startDate.$gte = new Date(startDate);
      if (endDate) query.startDate.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [events, total] = await Promise.all([
      Event.find(query)
        .populate('venue', 'name city')
        .populate('category', 'name')
        .sort(sortBy)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Event.countDocuments(query)
    ]);

    // Add revenue calculations
    const eventsWithRevenue = events.map(event => {
      const revenue = event.ticketTypes.reduce((sum, type) => {
        return sum + (type.sold * type.price);
      }, 0);

      const capacity = event.ticketTypes.reduce((sum, type) => sum + type.quantity, 0);
      const sold = event.ticketTypes.reduce((sum, type) => sum + type.sold, 0);
      const soldPercentage = capacity > 0 ? (sold / capacity * 100).toFixed(1) : 0;

      return {
        ...event,
        revenue,
        soldPercentage,
        remainingTickets: capacity - sold
      };
    });

    res.json({
      success: true,
      data: eventsWithRevenue,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + events.length < total
      }
    });

  } catch (error) {
    logger.error('Get promoter events failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Create event as promoter
 * @route   POST /api/events/promoters/events
 * @access  Private/Promoter
 * @returns {Object} Created event
 */
exports.createPromoterEvent = async (req, res, next) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new AppError('Validation failed', 400, errors.array()));
    }

    // Check promoter limits
    const promoter = await Promoter.findOne({ user: req.user.id });
    
    if (!promoter) {
      return next(new AppError('Promoter profile not found', 404));
    }

    if (promoter.verification.status !== 'verified') {
      return next(new AppError('Promoter account must be verified to create events', 403));
    }

    // Check event creation limit
    const activeEventCount = await Event.countDocuments({
      organizer: req.user.id,
      status: { $in: ['draft', 'published', 'on-sale'] }
    });

    if (activeEventCount >= promoter.settings.eventCreationLimit) {
      return next(new AppError(`Event creation limit reached (${promoter.settings.eventCreationLimit})`, 400));
    }

    // Check for suspicious patterns (fraud detection)
    const fraudCheck = await checkForFraudulentActivity(req.user.id, req.body);
    if (fraudCheck.suspicious) {
      logger.warn('Suspicious event creation attempt', {
        userId: req.user.id,
        reason: fraudCheck.reason,
        correlationId: req.correlationId
      });
      
      return next(new AppError('Event creation temporarily restricted. Please contact support.', 403));
    }

    // Create event with promoter metadata
    const eventData = {
      ...req.body,
      organizer: req.user.id,
      promoterSettings: {
        revenueShare: promoter.settings.revenueShare,
        payoutSchedule: promoter.settings.payoutSchedule,
        requiresApproval: promoter.settings.requiresApproval
      },
      status: promoter.settings.requiresApproval ? 'pending-approval' : 'draft'
    };

    // Forward to regular event creation logic
    req.body = eventData;
    const eventController = require('./eventController');
    return eventController.createEvent(req, res, next);

  } catch (error) {
    await session.abortTransaction();
    logger.error('Promoter event creation failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  } finally {
    session.endSession();
  }
};

/**
 * @desc    Get promoter analytics dashboard
 * @route   GET /api/events/promoters/analytics
 * @access  Private/Promoter
 * @returns {Object} Analytics data
 */
exports.getPromoterAnalytics = async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    // Get aggregated analytics
    const analytics = await Event.aggregate([
      {
        $match: {
          organizer: mongoose.Types.ObjectId(req.user.id),
          ...(startDate || endDate ? { createdAt: dateFilter } : {})
        }
      },
      {
        $facet: {
          overview: [
            {
              $group: {
                _id: null,
                totalEvents: { $sum: 1 },
                totalRevenue: {
                  $sum: {
                    $reduce: {
                      input: '$ticketTypes',
                      initialValue: 0,
                      in: {
                        $add: ['$$value', { $multiply: ['$$this.sold', '$$this.price'] }]
                      }
                    }
                  }
                },
                totalTicketsSold: {
                  $sum: { $sum: '$ticketTypes.sold' }
                },
                avgTicketPrice: {
                  $avg: { $avg: '$ticketTypes.price' }
                },
                totalViews: { $sum: '$analytics.views' },
                avgConversionRate: { $avg: '$analytics.conversionRate' }
              }
            }
          ],
          byStatus: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 }
              }
            }
          ],
          byCategory: [
            {
              $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'categoryInfo'
              }
            },
            {
              $unwind: '$categoryInfo'
            },
            {
              $group: {
                _id: '$categoryInfo.name',
                count: { $sum: 1 },
                revenue: {
                  $sum: {
                    $reduce: {
                      input: '$ticketTypes',
                      initialValue: 0,
                      in: {
                        $add: ['$$value', { $multiply: ['$$this.sold', '$$this.price'] }]
                      }
                    }
                  }
                }
              }
            }
          ],
          topEvents: [
            {
              $sort: { 'analytics.views': -1 }
            },
            {
              $limit: 5
            },
            {
              $project: {
                title: 1,
                startDate: 1,
                status: 1,
                views: '$analytics.views',
                revenue: {
                  $reduce: {
                    input: '$ticketTypes',
                    initialValue: 0,
                    in: {
                      $add: ['$$value', { $multiply: ['$$this.sold', '$$this.price'] }]
                    }
                  }
                }
              }
            }
          ]
        }
      }
    ]);

    // Get time series data
    const timeSeries = await getTimeSeriesAnalytics(req.user.id, dateFilter, groupBy);

    // Get payout information
    const payoutInfo = await getPayoutSummary(req.user.id);

    res.json({
      success: true,
      data: {
        overview: analytics[0].overview[0] || {},
        byStatus: analytics[0].byStatus,
        byCategory: analytics[0].byCategory,
        topEvents: analytics[0].topEvents,
        timeSeries,
        payoutInfo
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Get promoter analytics failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Manage team members
 * @route   POST /api/events/promoters/team
 * @access  Private/Promoter
 * @returns {Object} Team member data
 */
exports.addTeamMember = async (req, res, next) => {
  try {
    const { email, role, permissions } = req.body;

    const promoter = await Promoter.findOne({ user: req.user.id });
    
    if (!promoter) {
      return next(new AppError('Promoter profile not found', 404));
    }

    // Find user by email
    const teamMember = await User.findOne({ email });
    
    if (!teamMember) {
      return next(new AppError('User not found with this email', 404));
    }

    // Check if already a team member
    const existingMember = promoter.teamMembers.find(
      member => member.user.toString() === teamMember._id.toString()
    );
    
    if (existingMember) {
      return next(new AppError('User is already a team member', 400));
    }

    // Validate role and permissions
    const validRoles = ['manager', 'coordinator', 'marketing', 'finance'];
    if (!validRoles.includes(role)) {
      return next(new AppError('Invalid team member role', 400));
    }

    // Add team member
    promoter.teamMembers.push({
      user: teamMember._id,
      role,
      permissions: permissions || getDefaultPermissions(role),
      addedAt: new Date()
    });

    await promoter.save();

    // Send invitation email to team member
    logger.info('Team member added', {
      promoterId: promoter._id,
      teamMemberId: teamMember._id,
      role,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      data: {
        id: teamMember._id,
        name: teamMember.name,
        email: teamMember.email,
        role,
        permissions: permissions || getDefaultPermissions(role)
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Add team member failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Remove team member
 * @route   DELETE /api/events/promoters/team/:memberId
 * @access  Private/Promoter
 * @returns {Object} Success message
 */
exports.removeTeamMember = async (req, res, next) => {
  try {
    const promoter = await Promoter.findOne({ user: req.user.id });
    
    if (!promoter) {
      return next(new AppError('Promoter profile not found', 404));
    }

    const memberIndex = promoter.teamMembers.findIndex(
      member => member.user.toString() === req.params.memberId
    );

    if (memberIndex === -1) {
      return next(new AppError('Team member not found', 404));
    }

    promoter.teamMembers.splice(memberIndex, 1);
    await promoter.save();

    logger.info('Team member removed', {
      promoterId: promoter._id,
      teamMemberId: req.params.memberId,
      correlationId: req.correlationId
    });

    res.json({
      success: true,
      message: 'Team member removed successfully',
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      }
    });

  } catch (error) {
    logger.error('Remove team member failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

/**
 * @desc    Get payout history
 * @route   GET /api/events/promoters/payouts
 * @access  Private/Promoter
 * @returns {Object} Payout history
 */
exports.getPayoutHistory = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;

    const query = { promoter: req.user.id };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // This would typically query a Payout model
    const payouts = []; // Placeholder for actual payout data
    const total = 0;

    res.json({
      success: true,
      data: payouts,
      meta: {
        timestamp: new Date().toISOString(),
        version: '1.0',
        requestId: req.correlationId
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        hasMore: skip + payouts.length < total
      }
    });

  } catch (error) {
    logger.error('Get payout history failed', {
      error: error.message,
      userId: req.user.id,
      correlationId: req.correlationId
    });
    return next(error);
  }
};

// Helper functions

/**
 * Calculate promoter performance metrics
 */
async function calculatePromoterMetrics(userId) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const metrics = await Event.aggregate([
    {
      $match: {
        organizer: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: null,
        totalEvents: { $sum: 1 },
        completedEvents: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        cancelledEvents: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
        totalRevenue: {
          $sum: {
            $reduce: {
              input: '$ticketTypes',
              initialValue: 0,
              in: {
                $add: ['$$value', { $multiply: ['$$this.sold', '$$this.price'] }]
              }
            }
          }
        },
        avgAttendance: {
          $avg: {
            $divide: [
              { $sum: '$ticketTypes.sold' },
              { $sum: '$ticketTypes.quantity' }
            ]
          }
        }
      }
    }
  ]);

  return metrics[0] || {
    totalEvents: 0,
    completedEvents: 0,
    cancelledEvents: 0,
    totalRevenue: 0,
    avgAttendance: 0
  };
}

/**
 * Check for fraudulent activity patterns
 */
async function checkForFraudulentActivity(userId, eventData) {
  // Check for rapid event creation
  const recentEvents = await Event.countDocuments({
    organizer: userId,
    createdAt: { $gte: new Date(Date.now() - 3600000) } // Last hour
  });

  if (recentEvents >= 5) {
    return { suspicious: true, reason: 'Rapid event creation' };
  }

  // Check for duplicate events
  const similarEvent = await Event.findOne({
    organizer: userId,
    title: eventData.title,
    startDate: eventData.startDate
  });

  if (similarEvent) {
    return { suspicious: true, reason: 'Duplicate event detected' };
  }

  // Check for unrealistic pricing
  const maxPrice = Math.max(...eventData.ticketTypes.map(t => t.price));
  if (maxPrice > 5000) {
    return { suspicious: true, reason: 'Unusually high ticket price' };
  }

  return { suspicious: false };
}

/**
 * Get time series analytics data
 */
async function getTimeSeriesAnalytics(userId, dateFilter, groupBy) {
  const groupFormat = {
    day: '%Y-%m-%d',
    week: '%Y-W%V',
    month: '%Y-%m'
  };

  const pipeline = [
    {
      $match: {
        organizer: mongoose.Types.ObjectId(userId),
        ...(dateFilter ? { createdAt: dateFilter } : {})
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: groupFormat[groupBy] || groupFormat.day,
            date: '$createdAt'
          }
        },
        events: { $sum: 1 },
        revenue: {
          $sum: {
            $reduce: {
              input: '$ticketTypes',
              initialValue: 0,
              in: {
                $add: ['$$value', { $multiply: ['$$this.sold', '$$this.price'] }]
              }
            }
          }
        },
        tickets: {
          $sum: { $sum: '$ticketTypes.sold' }
        }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ];

  return await Event.aggregate(pipeline);
}

/**
 * Get payout summary
 */
async function getPayoutSummary(userId) {
  // This would typically calculate from a Payout model
  return {
    pendingAmount: 0,
    nextPayoutDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
    totalPaidOut: 0,
    lastPayoutDate: null
  };
}

/**
 * Get default permissions for role
 */
function getDefaultPermissions(role) {
  const permissions = {
    manager: ['create_events', 'edit_events', 'view_analytics', 'manage_team'],
    coordinator: ['create_events', 'edit_events', 'view_analytics'],
    marketing: ['edit_events', 'view_analytics'],
    finance: ['view_analytics', 'view_payouts']
  };

  return permissions[role] || [];
}

// Promoter Schema (for reference)
const promoterSchema = {
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  companyName: { type: String, required: true },
  businessType: { type: String, enum: ['individual', 'company', 'nonprofit'] },
  taxId: { type: String, required: true },
  verification: {
    status: { type: String, enum: ['pending', 'verified', 'rejected'] },
    documents: [{
      type: String,
      url: String,
      status: String,
      reviewedAt: Date
    }]
  },
  settings: {
    eventCreationLimit: Number,
    requiresApproval: Boolean,
    payoutSchedule: String,
    revenueShare: {
      platform: Number,
      promoter: Number
    }
  },
  teamMembers: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    role: String,
    permissions: [String],
    addedAt: Date
  }],
  analytics: {
    totalEvents: Number,
    totalTicketsSold: Number,
    totalRevenue: Number,
    averageRating: Number
  }
};

// Unit test examples
/**
 * Example unit tests:
 * 
 * describe('PromoterController', () => {
 *   describe('applyForPromoter', () => {
 *     it('should create promoter application with valid data', async () => {
 *       const req = mockRequest({
 *         body: {
 *           companyName: 'Test Events Inc',
 *           businessType: 'company',
 *           taxId: '12-3456789',
 *           documents: [{ type: 'business_license', url: 'http://...' }]
 *         },
 *         user: { id: 'user123' }
 *       });
 *       
 *       await promoterController.applyForPromoter(req, res, next);
 *       
 *       expect(res.status).toHaveBeenCalledWith(201);
 *       expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
 *         data: expect.objectContaining({
 *           status: 'pending'
 *         })
 *       }));
 *     });
 *   });
 *   
 *   describe('checkForFraudulentActivity', () => {
 *     it('should detect rapid event creation', async () => {
 *       // Create 5 events in last hour
 *       const result = await checkForFraudulentActivity(userId, eventData);
 *       
 *       expect(result).toEqual({
 *         suspicious: true,
 *         reason: 'Rapid event creation'
 *       });
 *     });
 *   });
 * });
 */

module.exports = exports;
