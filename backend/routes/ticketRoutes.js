// routes/ticketRoutes.js - Updated with controller integration

const express = require('express');
const router = express.Router();
const ticketController = require('../controllers/ticketController');
const { protect, organizer } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');

// All ticket routes are protected
router.use(protect);

// Get routes
router.get('/event/:eventId', rateLimiter(), ticketController.getTicketsByEvent);
router.get('/user/:userId', rateLimiter(), ticketController.getTicketsByUser);
router.get('/:id', rateLimiter(), ticketController.getTicketById);

// Transaction routes
router.post('/purchase', rateLimiter(), ticketController.purchaseTicket);
router.post('/transfer', rateLimiter(), ticketController.transferTicket);
router.post('/verify', rateLimiter(), organizer, ticketController.verifyTicket);

module.exports = router;
