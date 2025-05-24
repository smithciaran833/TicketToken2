const express = require('express');
const router = express.Router();

// Import sub-routers
const authRoutes = require('./auth');
const userRoutes = require('./users');
const eventRoutes = require('./events');
const ticketRoutes = require('./tickets');
const marketplaceRoutes = require('./marketplace');

// Mount sub-routers
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/events', eventRoutes);
router.use('/tickets', ticketRoutes);
router.use('/marketplace', marketplaceRoutes);

// API v1 welcome route
router.get('/', (req, res) => {
    res.json({
        message: 'TicketToken API v1',
        endpoints: {
            auth: '/api/v1/auth',
            users: '/api/v1/users',
            events: '/api/v1/events',
            tickets: '/api/v1/tickets',
            marketplace: '/api/v1/marketplace'
        }
    });
});

module.exports = router;
