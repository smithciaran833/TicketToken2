const express = require('express');
const router = express.Router();
const tokenGatedContentController = require('../controllers/tokenGatedContentController');
const { authenticateUser, verifyContentAccess } = require('../middleware/tokenAuth');

/**
 * Create new token-gated content
 * @route POST /api/token-gated-content
 * @access Private
 */
router.post('/', 
  authenticateUser, 
  tokenGatedContentController.createContent
);

/**
 * Get all token-gated content (metadata only)
 * @route GET /api/token-gated-content
 * @access Private
 */
router.get('/', 
  authenticateUser, 
  tokenGatedContentController.getAllContent
);

/**
 * Get token-gated content by ID (requires token ownership)
 * @route GET /api/token-gated-content/:id
 * @access Private + Token Ownership
 */
router.get('/:id', 
  authenticateUser, 
  verifyContentAccess, 
  tokenGatedContentController.getContentById
);

/**
 * Check if user has access to content
 * @route GET /api/token-gated-content/:id/check-access
 * @access Private
 */
router.get('/:id/check-access', 
  authenticateUser, 
  tokenGatedContentController.checkContentAccess
);

/**
 * Update token-gated content
 * @route PUT /api/token-gated-content/:id
 * @access Private (Creator only)
 */
router.put('/:id', 
  authenticateUser, 
  tokenGatedContentController.updateContent
);

/**
 * Delete token-gated content
 * @route DELETE /api/token-gated-content/:id
 * @access Private (Creator only)
 */
router.delete('/:id', 
  authenticateUser, 
  tokenGatedContentController.deleteContent
);

module.exports = router;
