// routes/contentRoutes.js - Routes for exclusive artist content
const express = require('express');
const router = express.Router();
const {
  createContent,
  getContentById,
  getContentByEvent,
  getContentByArtist,
  updateContent,
  deleteContent,
  checkContentAccess
} = require('../controllers/contentController');
const { protect, organizer, admin } = require('../middleware/authMiddleware');
const { rateLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/uploadMiddleware');

// All content routes require authentication
router.use(protect);

// Content CRUD operations
router.post('/', createContent);
router.get('/:id', getContentById);
router.put('/:id', updateContent);
router.delete('/:id', deleteContent);

// Content discovery
router.get('/event/:eventId', getContentByEvent);
router.get('/artist/:artistId', getContentByArtist);

// Content access
router.get('/:id/check-access', checkContentAccess);

module.exports = router;
