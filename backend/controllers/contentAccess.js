const express = require('express');
const router = express.Router();
const contentAccessController = require('../controllers/contentAccessController');
const tokenValidation = require('../middleware/tokenValidation');
const { validateContentSchema } = require('../middleware/validators');

// Apply JWT validation to all routes in this router
router.use(tokenValidation.validateJWT);

/**
 * @route   POST /api/content
 * @desc    Create new exclusive content
 * @access  Private (Creator/Admin)
 */
router.post(
  '/',
  validateContentSchema,
  contentAccessController.createContent
);

/**
 * @route   PUT /api/content/:id
 * @desc    Update existing content
 * @access  Private (Creator/Admin)
 */
router.put(
  '/:id',
  validateContentSchema,
  contentAccessController.updateContent
);

/**
 * @route   DELETE /api/content/:id
 * @desc    Delete content
 * @access  Private (Creator/Admin)
 */
router.delete(
  '/:id',
  contentAccessController.deleteContent
);

/**
 * @route   GET /api/content/:id
 * @desc    Get content by ID (metadata only)
 * @access  Private
 */
router.get(
  '/:id',
  contentAccessController.getContentById
);

/**
 * @route   GET /api/content
 * @desc    Get all content with filtering options
 * @access  Private
 */
router.get(
  '/',
  contentAccessController.getAllContent
);

/**
 * @route   GET /api/content/:id/validate
 * @desc    Validate if user has access to content
 * @access  Private
 */
router.get(
  '/:id/validate',
  contentAccessController.validateAccess
);

/**
 * @route   GET /api/content/user/accessible
 * @desc    Get all content the user has access to
 * @access  Private
 */
router.get(
  '/user/accessible',
  contentAccessController.getUserAccessibleContent
);

/**
 * @route   GET /api/content/:id/access
 * @desc    Access content with token validation
 * @access  Private
 */
router.get(
  '/:id/access',
  tokenValidation.validateContentAccess(),
  contentAccessController.accessContent
);

module.exports = router;
