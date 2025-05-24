// middleware/rateLimiter.js - Rate limiting middleware

const rateLimiters = {};

// Simple in-memory rate limiter
const createRateLimiter = (windowMs, maxRequests) => {
  return (req, res, next) => {
    const key = req.ip + req.route.path;
    const now = Date.now();
    
    if (!rateLimiters[key]) {
      rateLimiters[key] = [];
    }
    
    // Remove old entries
    rateLimiters[key] = rateLimiters[key].filter(
      timestamp => now - timestamp < windowMs
    );
    
    // Check if limit exceeded
    if (rateLimiters[key].length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        errors: { 
          rateLimit: `Too many requests. Please try again in ${Math.ceil(windowMs / 1000)} seconds.`
        },
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    // Add current request
    rateLimiters[key].push(now);
    next();
  };
};

// Different rate limits for different endpoints
const rateLimiter = (type) => {
  switch (type) {
    case 'register':
      return createRateLimiter(15 * 60 * 1000, 5); // 5 registrations per 15 minutes
    case 'login':
      return createRateLimiter(15 * 60 * 1000, 10); // 10 login attempts per 15 minutes
    case 'wallet-auth':
      return createRateLimiter(5 * 60 * 1000, 20); // 20 wallet auth per 5 minutes
    case 'check':
      return createRateLimiter(60 * 1000, 30); // 30 availability checks per minute
    default:
      return createRateLimiter(60 * 1000, 60); // Default: 60 requests per minute
  }
};

module.exports = { rateLimiter };
