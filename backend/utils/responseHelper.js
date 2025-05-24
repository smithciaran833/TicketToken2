// utils/responseHelpers.js - Standardized API response helpers

// Success response helper
const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
};

// Error response helper
const sendError = (res, message = 'Error', errors = {}, statusCode = 400) => {
  return res.status(statusCode).json({
    success: false,
    message,
    errors,
    timestamp: new Date().toISOString()
  });
};

// Validation error helper
const sendValidationError = (res, errors) => {
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    errors,
    timestamp: new Date().toISOString()
  });
};

// Not found error helper
const sendNotFound = (res, resource = 'Resource') => {
  return res.status(404).json({
    success: false,
    message: `${resource} not found`,
    errors: { [resource.toLowerCase()]: `${resource} does not exist` },
    timestamp: new Date().toISOString()
  });
};

// Unauthorized error helper
const sendUnauthorized = (res, message = 'Unauthorized access') => {
  return res.status(401).json({
    success: false,
    message,
    errors: { auth: 'Please login to access this resource' },
    timestamp: new Date().toISOString()
  });
};

// Forbidden error helper
const sendForbidden = (res, message = 'Access forbidden') => {
  return res.status(403).json({
    success: false,
    message,
    errors: { permission: 'You do not have permission to access this resource' },
    timestamp: new Date().toISOString()
  });
};

// Conflict error helper
const sendConflict = (res, field, message = 'Resource already exists') => {
  return res.status(409).json({
    success: false,
    message,
    errors: { [field]: `This ${field} already exists` },
    timestamp: new Date().toISOString()
  });
};

// Server error helper
const sendServerError = (res, message = 'Internal server error') => {
  return res.status(500).json({
    success: false,
    message,
    errors: { server: 'Something went wrong on our end' },
    timestamp: new Date().toISOString()
  });
};

// Paginated response helper
const sendPaginatedResponse = (res, data, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      currentPage: pagination.page,
      totalPages: pagination.totalPages,
      totalItems: pagination.totalItems,
      itemsPerPage: pagination.limit,
      hasNext: pagination.page < pagination.totalPages,
      hasPrev: pagination.page > 1
    },
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendUnauthorized,
  sendForbidden,
  sendConflict,
  sendServerError,
  sendPaginatedResponse,
};
