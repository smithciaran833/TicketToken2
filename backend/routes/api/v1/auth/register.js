const express = require('express');
const router = express.Router();
const authController = require('../../../../controllers/authController');
const { validateRegister } = require('../../../../middleware/validation');

router.post('/', validateRegister, authController.register);

module.exports = router;
