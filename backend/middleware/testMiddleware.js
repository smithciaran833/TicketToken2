// middleware/testMiddleware.js - Example middleware for testing

// Simple middleware to log all requests
const logger = (req, res, next) => {
  console.log(`${req.method} ${req.url} at ${new Date().toISOString()}`);
  next();
};

// Test middleware to check if authentication is working
const authTest = (req, res) => {
  res.json({
    message: 'Authentication successful',
    user: {
      id: req.user._id,
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role
    }
  });
};

module.exports = { logger, authTest };
