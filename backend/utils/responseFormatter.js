const { HTTP_STATUS, ERROR_CODES } = require('./constants');
const { logger } = require('./logger');

// =============================================================================
// RESPONSE FORMATTER UTILITY
// =============================================================================

/**
 * Standardized API Response Formatter
 * Provides consistent response structure across all API endpoints
 */
class ResponseFormatter {
  /**
   * Format successful response
   * @param {Express.Response} res - Express response object
   * @param {*} data - Response data
   * @param {string} message - Success message
   * @param {Object} meta - Additional metadata
   * @param {number} statusCode - HTTP status code (default: 200)
   * @returns {Express.Response} Express response
   */
  static formatSuccess(res, data = null, message = 'Success', meta = {}, statusCode = 200) {
    const response = {
      success: true,
      status: statusCode,
      message,
      data,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: res.locals.correlationId || res.req?.correlationId,
        version: process.env.API_VERSION || 'v1',
        environment: process.env.NODE_ENV || 'development',
        ...meta
      }
    };

    // Add response headers
    ResponseFormatter._setCommonHeaders(res);
    
    // Log successful response for debugging
    if (res.req) {
      logger.debug('API Response', {
        method: res.req.method,
        url: res.req.originalUrl,
        statusCode,
        correlationId: response.meta.requestId,
        responseSize: JSON.stringify(response).length
      });
    }

    return res.status(statusCode).json(response);
  }

  /**
   * Format error response
   * @param {Express.Response} res - Express response object
   * @param {Error|Object|string} error - Error object, error code object, or message
   * @param {number} statusCode - HTTP status code (default: 500)
   * @param {Object} meta - Additional metadata
   * @returns {Express.Response} Express response
   */
  static formatError(res, error, statusCode = 500, meta = {}) {
    let errorInfo = {
      code: 'UNKNOWN_ERROR',
      message: 'An unexpected error occurred',
      description: null
    };

    // Handle different error types
    if (typeof error === 'string') {
      errorInfo.message = error;
    } else if (error && typeof error === 'object') {
      if (error.code && error.message) {
        // Error code object from constants
        errorInfo = {
          code: error.code,
          message: error.message,
          description: error.description || null
        };
      } else if (error instanceof Error) {
        // JavaScript Error object
        errorInfo = {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message,
          description: error.description || null
        };
        
        // Include stack trace in development
        if (process.env.NODE_ENV === 'development') {
          errorInfo.stack = error.stack;
        }
      } else {
        // Generic object
        errorInfo.message = error.message || error.toString();
        errorInfo.code = error.code || 'UNKNOWN_ERROR';
      }
    }

    const response = {
      success: false,
      status: statusCode,
      error: errorInfo,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: res.locals.correlationId || res.req?.correlationId,
        version: process.env.API_VERSION || 'v1',
        environment: process.env.NODE_ENV || 'development',
        ...meta
      }
    };

    // Add response headers
    ResponseFormatter._setCommonHeaders(res);
    
    // Log error response
    if (res.req) {
      logger.error('API Error Response', {
        method: res.req.method,
        url: res.req.originalUrl,
        statusCode,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        correlationId: response.meta.requestId,
        userId: res.req.user?.id,
        ip: res.req.ip
      });
    }

    return res.status(statusCode).json(response);
  }

  /**
   * Format paginated response
   * @param {Express.Response} res - Express response object
   * @param {Array} data - Array of data items
   * @param {number} page - Current page number
   * @param {number} limit - Items per page
   * @param {number} total - Total number of items
   * @param {string} message - Success message
   * @param {Object} meta - Additional metadata
   * @returns {Express.Response} Express response
   */
  static formatPaginated(res, data = [], page = 1, limit = 20, total = 0, message = 'Success', meta = {}) {
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    const startIndex = (page - 1) * limit + 1;
    const endIndex = Math.min(page * limit, total);

    const paginationMeta = {
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: parseInt(total),
        itemsPerPage: parseInt(limit),
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null,
        startIndex: total > 0 ? startIndex : 0,
        endIndex: total > 0 ? endIndex : 0
      },
      ...meta
    };

    // Add pagination headers
    ResponseFormatter._setPaginationHeaders(res, page, totalPages, total, limit);

    return ResponseFormatter.formatSuccess(res, data, message, paginationMeta);
  }

  /**
   * Format validation error response
   * @param {Express.Response} res - Express response object
   * @param {Array|Object} errors - Validation errors
   * @param {string} message - Error message
   * @returns {Express.Response} Express response
   */
  static formatValidationError(res, errors, message = 'Validation failed') {
    let formattedErrors = [];

    if (Array.isArray(errors)) {
      formattedErrors = errors.map(error => ({
        field: error.field || error.param || error.path,
        message: error.message || error.msg,
        value: error.value,
        code: error.code || 'VALIDATION_ERROR'
      }));
    } else if (errors && typeof errors === 'object') {
      // Handle different validation error formats
      if (errors.details) {
        // Joi validation errors
        formattedErrors = errors.details.map(detail => ({
          field: detail.path?.join('.') || detail.context?.key,
          message: detail.message,
          value: detail.context?.value,
          code: detail.type || 'VALIDATION_ERROR'
        }));
      } else if (errors.errors) {
        // Mongoose validation errors
        formattedErrors = Object.keys(errors.errors).map(field => ({
          field,
          message: errors.errors[field].message,
          value: errors.errors[field].value,
          code: errors.errors[field].kind || 'VALIDATION_ERROR'
        }));
      } else {
        // Generic error object
        formattedErrors = Object.keys(errors).map(field => ({
          field,
          message: errors[field],
          code: 'VALIDATION_ERROR'
        }));
      }
    }

    const response = {
      success: false,
      status: 422,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        description: 'One or more fields contain invalid data',
        details: formattedErrors
      },
      meta: {
        timestamp: new Date().toISOString(),
        requestId: res.locals.correlationId || res.req?.correlationId,
        version: process.env.API_VERSION || 'v1',
        environment: process.env.NODE_ENV || 'development',
        validationErrorCount: formattedErrors.length
      }
    };

    // Add response headers
    ResponseFormatter._setCommonHeaders(res);
    
    // Log validation error
    if (res.req) {
      logger.warn('API Validation Error', {
        method: res.req.method,
        url: res.req.originalUrl,
        errors: formattedErrors,
        correlationId: response.meta.requestId,
        userId: res.req.user?.id
      });
    }

    return res.status(422).json(response);
  }

  /**
   * Format rate limit exceeded response
   * @param {Express.Response} res - Express response object
   * @param {Object} rateLimitInfo - Rate limit information
   * @returns {Express.Response} Express response
   */
  static formatRateLimitError(res, rateLimitInfo = {}) {
    const { limit, remaining, resetTime } = rateLimitInfo;
    
    ResponseFormatter._setRateLimitHeaders(res, limit, remaining, resetTime);

    return ResponseFormatter.formatError(
      res,
      {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        description: 'Rate limit exceeded. Please try again later.'
      },
      429,
      {
        rateLimit: {
          limit,
          remaining,
          resetTime: resetTime ? new Date(resetTime).toISOString() : null
        }
      }
    );
  }

  /**
   * Format unauthorized response
   * @param {Express.Response} res - Express response object
   * @param {string} message - Custom message
   * @returns {Express.Response} Express response
   */
  static formatUnauthorized(res, message = 'Authentication required') {
    return ResponseFormatter.formatError(
      res,
      ERROR_CODES.AUTH_TOKEN_INVALID || {
        code: 'UNAUTHORIZED',
        message,
        description: 'Valid authentication credentials are required'
      },
      401
    );
  }

  /**
   * Format forbidden response
   * @param {Express.Response} res - Express response object
   * @param {string} message - Custom message
   * @returns {Express.Response} Express response
   */
  static formatForbidden(res, message = 'Access denied') {
    return ResponseFormatter.formatError(
      res,
      ERROR_CODES.USER_INSUFFICIENT_PERMISSIONS || {
        code: 'FORBIDDEN',
        message,
        description: 'You do not have permission to access this resource'
      },
      403
    );
  }

  /**
   * Format not found response
   * @param {Express.Response} res - Express response object
   * @param {string} resource - Resource type
   * @returns {Express.Response} Express response
   */
  static formatNotFound(res, resource = 'Resource') {
    return ResponseFormatter.formatError(
      res,
      {
        code: 'NOT_FOUND',
        message: `${resource} not found`,
        description: `The requested ${resource.toLowerCase()} could not be found`
      },
      404
    );
  }

  /**
   * Format conflict response
   * @param {Express.Response} res - Express response object
   * @param {string} message - Custom message
   * @returns {Express.Response} Express response
   */
  static formatConflict(res, message = 'Resource conflict') {
    return ResponseFormatter.formatError(
      res,
      {
        code: 'CONFLICT',
        message,
        description: 'The request conflicts with the current state of the resource'
      },
      409
    );
  }

  /**
   * Format created response (for POST requests)
   * @param {Express.Response} res - Express response object
   * @param {*} data - Created resource data
   * @param {string} message - Success message
   * @param {Object} meta - Additional metadata
   * @returns {Express.Response} Express response
   */
  static formatCreated(res, data, message = 'Resource created successfully', meta = {}) {
    return ResponseFormatter.formatSuccess(res, data, message, meta, 201);
  }

  /**
   * Format no content response (for DELETE requests)
   * @param {Express.Response} res - Express response object
   * @param {string} message - Success message
   * @returns {Express.Response} Express response
   */
  static formatNoContent(res, message = 'Resource deleted successfully') {
    const response = {
      success: true,
      status: 204,
      message,
      meta: {
        timestamp: new Date().toISOString(),
        requestId: res.locals.correlationId || res.req?.correlationId,
        version: process.env.API_VERSION || 'v1'
      }
    };

    ResponseFormatter._setCommonHeaders(res);
    
    return res.status(204).json(response);
  }

  // =============================================================================
  // PRIVATE HELPER METHODS
  // =============================================================================

  /**
   * Set common response headers
   * @param {Express.Response} res - Express response object
   * @private
   */
  static _setCommonHeaders(res) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-API-Version', process.env.API_VERSION || 'v1');
    res.setHeader('X-Powered-By', 'Ticketing API');
    
    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // CORS headers (if not handled by middleware)
    if (!res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
    }
  }

  /**
   * Set pagination headers
   * @param {Express.Response} res - Express response object
   * @param {number} page - Current page
   * @param {number} totalPages - Total pages
   * @param {number} total - Total items
   * @param {number} limit - Items per page
   * @private
   */
  static _setPaginationHeaders(res, page, totalPages, total, limit) {
    res.setHeader('X-Total-Count', total);
    res.setHeader('X-Total-Pages', totalPages);
    res.setHeader('X-Current-Page', page);
    res.setHeader('X-Per-Page', limit);
    
    // Link header for pagination navigation
    const links = [];
    const baseUrl = res.req ? `${res.req.protocol}://${res.req.get('host')}${res.req.path}` : '';
    
    if (page > 1) {
      links.push(`<${baseUrl}?page=1&limit=${limit}>; rel="first"`);
      links.push(`<${baseUrl}?page=${page - 1}&limit=${limit}>; rel="prev"`);
    }
    
    if (page < totalPages) {
      links.push(`<${baseUrl}?page=${page + 1}&limit=${limit}>; rel="next"`);
      links.push(`<${baseUrl}?page=${totalPages}&limit=${limit}>; rel="last"`);
    }
    
    if (links.length > 0) {
      res.setHeader('Link', links.join(', '));
    }
  }

  /**
   * Set rate limiting headers
   * @param {Express.Response} res - Express response object
   * @param {number} limit - Rate limit
   * @param {number} remaining - Remaining requests
   * @param {number} resetTime - Reset timestamp
   * @private
   */
  static _setRateLimitHeaders(res, limit, remaining, resetTime) {
    if (limit !== undefined) {
      res.setHeader('X-RateLimit-Limit', limit);
    }
    if (remaining !== undefined) {
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining));
    }
    if (resetTime) {
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000));
    }
  }

  /**
   * Set cache headers
   * @param {Express.Response} res - Express response object
   * @param {number} maxAge - Cache max age in seconds
   * @param {boolean} isPrivate - Whether cache should be private
   * @private
   */
  static _setCacheHeaders(res, maxAge = 0, isPrivate = false) {
    if (maxAge > 0) {
      const cacheControl = isPrivate ? 'private' : 'public';
      res.setHeader('Cache-Control', `${cacheControl}, max-age=${maxAge}`);
      res.setHeader('Expires', new Date(Date.now() + maxAge * 1000).toUTCString());
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}

// =============================================================================
// MIDDLEWARE FUNCTIONS
// =============================================================================

/**
 * Middleware to add cache headers based on route configuration
 * @param {number} maxAge - Cache max age in seconds
 * @param {boolean} isPrivate - Whether cache should be private
 * @returns {Function} Express middleware function
 */
const cacheMiddleware = (maxAge = 300, isPrivate = false) => {
  return (req, res, next) => {
    ResponseFormatter._setCacheHeaders(res, maxAge, isPrivate);
    next();
  };
};

/**
 * Middleware to add rate limit headers
 * @param {Object} rateLimitInfo - Rate limit information
 * @returns {Function} Express middleware function
 */
const rateLimitMiddleware = (rateLimitInfo) => {
  return (req, res, next) => {
    ResponseFormatter._setRateLimitHeaders(
      res,
      rateLimitInfo.limit,
      rateLimitInfo.remaining,
      rateLimitInfo.resetTime
    );
    next();
  };
};

/**
 * Express error handling middleware
 * @param {Error} err - Error object
 * @param {Express.Request} req - Express request object
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  // Handle different types of errors
  if (err.name === 'ValidationError') {
    return ResponseFormatter.formatValidationError(res, err);
  }
  
  if (err.name === 'CastError') {
    return ResponseFormatter.formatError(res, 'Invalid resource ID format', 400);
  }
  
  if (err.code === 11000) {
    return ResponseFormatter.formatConflict(res, 'Resource already exists');
  }
  
  if (err.statusCode === 429) {
    return ResponseFormatter.formatRateLimitError(res, err.rateLimitInfo);
  }
  
  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  return ResponseFormatter.formatError(res, err, statusCode);
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ResponseFormatter,
  
  // Convenience methods
  formatSuccess: ResponseFormatter.formatSuccess,
  formatError: ResponseFormatter.formatError,
  formatPaginated: ResponseFormatter.formatPaginated,
  formatValidationError: ResponseFormatter.formatValidationError,
  formatRateLimitError: ResponseFormatter.formatRateLimitError,
  formatUnauthorized: ResponseFormatter.formatUnauthorized,
  formatForbidden: ResponseFormatter.formatForbidden,
  formatNotFound: ResponseFormatter.formatNotFound,
  formatConflict: ResponseFormatter.formatConflict,
  formatCreated: ResponseFormatter.formatCreated,
  formatNoContent: ResponseFormatter.formatNoContent,
  
  // Middleware
  cacheMiddleware,
  rateLimitMiddleware,
  errorHandler
};
