// backend/routes/eventRoutes.js

const express = require('express');
const router = express.Router();
const {
  createEvent,
  getEvents,
  getNearbyEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  getEventsByOrganizer,
  getCategories,
  getTags,
  getPromoterStats
} = require('../controllers/eventController');
const { protect, organizer, admin } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');

// Public routes
router.get('/', rateLimiter(), getEvents);
router.get('/nearby', rateLimiter(), getNearbyEvents);
router.get('/categories', rateLimiter(), getCategories);
router.get('/tags', rateLimiter(), getTags);
router.get('/:id', rateLimiter(), getEventById);
router.get('/organizer/:id', rateLimiter(), getEventsByOrganizer);

// Protected routes for event creators
router.post('/', protect, rateLimiter(), createEvent);
router.put('/:id', protect, rateLimiter(), updateEvent);
router.delete('/:id', protect, rateLimiter(), deleteEvent);

// Promoter-specific routes
router.get('/promoter/stats', protect, organizer, getPromoterStats);

module.exports = router;
