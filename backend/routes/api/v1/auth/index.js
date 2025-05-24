const express = require('express');
const router = express.Router();
const authController = require('../../../../controllers/authController');

// Mount individual auth routes
router.use('/register', require('./register'));
router.use('/login', require('./login'));
router.use('/logout', require('./logout'));
router.use('/refresh', require('./refresh'));
router.use('/password-reset', require('./password-reset'));

module.exports = router;
