/**
 * Application Constants
 * All constants are frozen to prevent modification
 */

// =============================================================================
// HTTP STATUS CODES AND MESSAGES
// =============================================================================

/**
 * HTTP Status Codes with corresponding messages
 * @readonly
 */
const HTTP_STATUS = Object.freeze({
  // Success 2xx
  OK: Object.freeze({
    code: 200,
    message: 'OK'
  }),
  CREATED: Object.freeze({
    code: 201,
    message: 'Created'
  }),
  ACCEPTED: Object.freeze({
    code: 202,
    message: 'Accepted'
  }),
  NO_CONTENT: Object.freeze({
    code: 204,
    message: 'No Content'
  }),

  // Client Error 4xx
  BAD_REQUEST: Object.freeze({
    code: 400,
    message: 'Bad Request'
  }),
  UNAUTHORIZED: Object.freeze({
    code: 401,
    message: 'Unauthorized'
  }),
  FORBIDDEN: Object.freeze({
    code: 403,
    message: 'Forbidden'
  }),
  NOT_FOUND: Object.freeze({
    code: 404,
    message: 'Not Found'
  }),
  METHOD_NOT_ALLOWED: Object.freeze({
    code: 405,
    message: 'Method Not Allowed'
  }),
  CONFLICT: Object.freeze({
    code: 409,
    message: 'Conflict'
  }),
  UNPROCESSABLE_ENTITY: Object.freeze({
    code: 422,
    message: 'Unprocessable Entity'
  }),
  TOO_MANY_REQUESTS: Object.freeze({
    code: 429,
    message: 'Too Many Requests'
  }),

  // Server Error 5xx
  INTERNAL_SERVER_ERROR: Object.freeze({
    code: 500,
    message: 'Internal Server Error'
  }),
  NOT_IMPLEMENTED: Object.freeze({
    code: 501,
    message: 'Not Implemented'
  }),
  BAD_GATEWAY: Object.freeze({
    code: 502,
    message: 'Bad Gateway'
  }),
  SERVICE_UNAVAILABLE: Object.freeze({
    code: 503,
    message: 'Service Unavailable'
  }),
  GATEWAY_TIMEOUT: Object.freeze({
    code: 504,
    message: 'Gateway Timeout'
  })
});

// =============================================================================
// ERROR CODES AND DESCRIPTIONS
// =============================================================================

/**
 * Application Error Codes with descriptions
 * @readonly
 */
const ERROR_CODES = Object.freeze({
  // Authentication Errors (1000-1099)
  AUTH_INVALID_CREDENTIALS: Object.freeze({
    code: 1001,
    message: 'Invalid email or password',
    description: 'The provided credentials do not match any user account'
  }),
  AUTH_TOKEN_EXPIRED: Object.freeze({
    code: 1002,
    message: 'Authentication token has expired',
    description: 'The provided JWT token has expired and needs to be refreshed'
  }),
  AUTH_TOKEN_INVALID: Object.freeze({
    code: 1003,
    message: 'Invalid authentication token',
    description: 'The provided token is malformed or invalid'
  }),
  AUTH_ACCOUNT_LOCKED: Object.freeze({
    code: 1004,
    message: 'Account is temporarily locked',
    description: 'Account has been locked due to multiple failed login attempts'
  }),
  AUTH_EMAIL_NOT_VERIFIED: Object.freeze({
    code: 1005,
    message: 'Email address not verified',
    description: 'Please verify your email address before proceeding'
  }),
  AUTH_2FA_REQUIRED: Object.freeze({
    code: 1006,
    message: 'Two-factor authentication required',
    description: 'This account requires 2FA verification'
  }),

  // User Errors (1100-1199)
  USER_NOT_FOUND: Object.freeze({
    code: 1101,
    message: 'User not found',
    description: 'No user exists with the provided identifier'
  }),
  USER_ALREADY_EXISTS: Object.freeze({
    code: 1102,
    message: 'User already exists',
    description: 'A user with this email address already exists'
  }),
  USER_INSUFFICIENT_PERMISSIONS: Object.freeze({
    code: 1103,
    message: 'Insufficient permissions',
    description: 'User does not have required permissions for this action'
  }),
  USER_PROFILE_INCOMPLETE: Object.freeze({
    code: 1104,
    message: 'User profile incomplete',
    description: 'Required profile information is missing'
  }),

  // Event Errors (1200-1299)
  EVENT_NOT_FOUND: Object.freeze({
    code: 1201,
    message: 'Event not found',
    description: 'No event exists with the provided identifier'
  }),
  EVENT_CAPACITY_EXCEEDED: Object.freeze({
    code: 1202,
    message: 'Event capacity exceeded',
    description: 'No more tickets available for this event'
  }),
  EVENT_SALES_CLOSED: Object.freeze({
    code: 1203,
    message: 'Ticket sales closed',
    description: 'Ticket sales for this event are no longer active'
  }),
  EVENT_INVALID_DATE: Object.freeze({
    code: 1204,
    message: 'Invalid event date',
    description: 'Event date must be in the future'
  }),
  EVENT_DUPLICATE_TICKET: Object.freeze({
    code: 1205,
    message: 'Duplicate ticket purchase',
    description: 'User has already purchased a ticket for this event'
  }),

  // Payment Errors (1300-1399)
  PAYMENT_FAILED: Object.freeze({
    code: 1301,
    message: 'Payment processing failed',
    description: 'Unable to process payment with the provided information'
  }),
  PAYMENT_INSUFFICIENT_FUNDS: Object.freeze({
    code: 1302,
    message: 'Insufficient funds',
    description: 'Payment method does not have sufficient funds'
  }),
  PAYMENT_INVALID_CARD: Object.freeze({
    code: 1303,
    message: 'Invalid payment card',
    description: 'The provided payment card information is invalid'
  }),
  PAYMENT_DECLINED: Object.freeze({
    code: 1304,
    message: 'Payment declined',
    description: 'Payment was declined by the payment processor'
  }),

  // Blockchain Errors (1400-1499)
  BLOCKCHAIN_TRANSACTION_FAILED: Object.freeze({
    code: 1401,
    message: 'Blockchain transaction failed',
    description: 'Failed to execute blockchain transaction'
  }),
  BLOCKCHAIN_INSUFFICIENT_GAS: Object.freeze({
    code: 1402,
    message: 'Insufficient gas fee',
    description: 'Transaction requires higher gas fee'
  }),
  BLOCKCHAIN_INVALID_ADDRESS: Object.freeze({
    code: 1403,
    message: 'Invalid wallet address',
    description: 'The provided wallet address is not valid'
  }),
  BLOCKCHAIN_NETWORK_ERROR: Object.freeze({
    code: 1404,
    message: 'Blockchain network error',
    description: 'Unable to connect to blockchain network'
  }),

  // File Upload Errors (1500-1599)
  FILE_TOO_LARGE: Object.freeze({
    code: 1501,
    message: 'File too large',
    description: 'File size exceeds maximum allowed limit'
  }),
  FILE_INVALID_TYPE: Object.freeze({
    code: 1502,
    message: 'Invalid file type',
    description: 'File type is not allowed'
  }),
  FILE_UPLOAD_FAILED: Object.freeze({
    code: 1503,
    message: 'File upload failed',
    description: 'Unable to upload file to storage'
  }),
  FILE_VIRUS_DETECTED: Object.freeze({
    code: 1504,
    message: 'Malicious file detected',
    description: 'File failed security scan'
  }),

  // Validation Errors (1600-1699)
  VALIDATION_REQUIRED_FIELD: Object.freeze({
    code: 1601,
    message: 'Required field missing',
    description: 'One or more required fields are missing'
  }),
  VALIDATION_INVALID_FORMAT: Object.freeze({
    code: 1602,
    message: 'Invalid field format',
    description: 'Field does not match required format'
  }),
  VALIDATION_OUT_OF_RANGE: Object.freeze({
    code: 1603,
    message: 'Value out of range',
    description: 'Field value is outside acceptable range'
  }),
  VALIDATION_DUPLICATE_VALUE: Object.freeze({
    code: 1604,
    message: 'Duplicate value',
    description: 'Value must be unique'
  }),

  // System Errors (1700-1799)
  SYSTEM_MAINTENANCE: Object.freeze({
    code: 1701,
    message: 'System under maintenance',
    description: 'System is temporarily unavailable for maintenance'
  }),
  SYSTEM_OVERLOADED: Object.freeze({
    code: 1702,
    message: 'System overloaded',
    description: 'System is currently experiencing high load'
  }),
  SYSTEM_DATABASE_ERROR: Object.freeze({
    code: 1703,
    message: 'Database error',
    description: 'Unable to connect to database'
  }),
  SYSTEM_EXTERNAL_SERVICE_ERROR: Object.freeze({
    code: 1704,
    message: 'External service error',
    description: 'External service is unavailable'
  })
});

// =============================================================================
// USER ROLES AND PERMISSIONS
// =============================================================================

/**
 * User roles with associated permissions
 * @readonly
 */
const USER_ROLES = Object.freeze({
  SUPER_ADMIN: Object.freeze({
    name: 'super_admin',
    displayName: 'Super Administrator',
    level: 100,
    permissions: Object.freeze([
      'manage_users',
      'manage_events',
      'manage_payments',
      'manage_system',
      'view_analytics',
      'manage_roles',
      'manage_settings',
      'export_data',
      'manage_blockchain',
      'moderate_content'
    ])
  }),
  ADMIN: Object.freeze({
    name: 'admin',
    displayName: 'Administrator',
    level: 80,
    permissions: Object.freeze([
      'manage_users',
      'manage_events',
      'manage_payments',
      'view_analytics',
      'export_data',
      'moderate_content'
    ])
  }),
  ORGANIZER: Object.freeze({
    name: 'organizer',
    displayName: 'Event Organizer',
    level: 60,
    permissions: Object.freeze([
      'create_events',
      'manage_own_events',
      'view_event_analytics',
      'manage_tickets',
      'export_event_data'
    ])
  }),
  MODERATOR: Object.freeze({
    name: 'moderator',
    displayName: 'Moderator',
    level: 40,
    permissions: Object.freeze([
      'moderate_content',
      'view_reports',
      'manage_user_reports'
    ])
  }),
  USER: Object.freeze({
    name: 'user',
    displayName: 'User',
    level: 20,
    permissions: Object.freeze([
      'purchase_tickets',
      'view_own_tickets',
      'update_profile',
      'view_events'
    ])
  }),
  GUEST: Object.freeze({
    name: 'guest',
    displayName: 'Guest',
    level: 0,
    permissions: Object.freeze([
      'view_events',
      'register_account'
    ])
  })
});

/**
 * Individual permissions available in the system
 * @readonly
 */
const PERMISSIONS = Object.freeze({
  // User Management
  MANAGE_USERS: 'manage_users',
  VIEW_USER_PROFILES: 'view_user_profiles',
  
  // Event Management
  CREATE_EVENTS: 'create_events',
  MANAGE_EVENTS: 'manage_events',
  MANAGE_OWN_EVENTS: 'manage_own_events',
  VIEW_EVENTS: 'view_events',
  DELETE_EVENTS: 'delete_events',
  
  // Ticket Management
  PURCHASE_TICKETS: 'purchase_tickets',
  MANAGE_TICKETS: 'manage_tickets',
  VIEW_OWN_TICKETS: 'view_own_tickets',
  TRANSFER_TICKETS: 'transfer_tickets',
  
  // Payment Management
  MANAGE_PAYMENTS: 'manage_payments',
  PROCESS_REFUNDS: 'process_refunds',
  VIEW_PAYMENT_HISTORY: 'view_payment_history',
  
  // Analytics and Reporting
  VIEW_ANALYTICS: 'view_analytics',
  VIEW_EVENT_ANALYTICS: 'view_event_analytics',
  EXPORT_DATA: 'export_data',
  EXPORT_EVENT_DATA: 'export_event_data',
  
  // System Management
  MANAGE_SYSTEM: 'manage_system',
  MANAGE_SETTINGS: 'manage_settings',
  MANAGE_ROLES: 'manage_roles',
  
  // Content Moderation
  MODERATE_CONTENT: 'moderate_content',
  VIEW_REPORTS: 'view_reports',
  MANAGE_USER_REPORTS: 'manage_user_reports',
  
  // Profile Management
  UPDATE_PROFILE: 'update_profile',
  UPDATE_OWN_PROFILE: 'update_own_profile',
  
  // Account Management
  REGISTER_ACCOUNT: 'register_account',
  DELETE_ACCOUNT: 'delete_account',
  
  // Blockchain Operations
  MANAGE_BLOCKCHAIN: 'manage_blockchain',
  MINT_NFTS: 'mint_nfts'
});

// =============================================================================
// EVENT STATUSES AND TICKET TYPES
// =============================================================================

/**
 * Event status definitions
 * @readonly
 */
const EVENT_STATUS = Object.freeze({
  DRAFT: Object.freeze({
    value: 'draft',
    displayName: 'Draft',
    description: 'Event is being created and not yet published',
    color: '#6B7280'
  }),
  PENDING_APPROVAL: Object.freeze({
    value: 'pending_approval',
    displayName: 'Pending Approval',
    description: 'Event is awaiting admin approval',
    color: '#F59E0B'
  }),
  ACTIVE: Object.freeze({
    value: 'active',
    displayName: 'Active',
    description: 'Event is live and tickets are available',
    color: '#10B981'
  }),
  SOLD_OUT: Object.freeze({
    value: 'sold_out',
    displayName: 'Sold Out',
    description: 'All tickets have been sold',
    color: '#EF4444'
  }),
  CANCELLED: Object.freeze({
    value: 'cancelled',
    displayName: 'Cancelled',
    description: 'Event has been cancelled',
    color: '#DC2626'
  }),
  COMPLETED: Object.freeze({
    value: 'completed',
    displayName: 'Completed',
    description: 'Event has finished',
    color: '#6366F1'
  }),
  POSTPONED: Object.freeze({
    value: 'postponed',
    displayName: 'Postponed',
    description: 'Event has been postponed to a later date',
    color: '#F97316'
  })
});

/**
 * Ticket type definitions
 * @readonly
 */
const TICKET_TYPES = Object.freeze({
  GENERAL_ADMISSION: Object.freeze({
    value: 'general_admission',
    displayName: 'General Admission',
    description: 'Standard entry ticket',
    transferable: true,
    refundable: true
  }),
  VIP: Object.freeze({
    value: 'vip',
    displayName: 'VIP',
    description: 'Premium access with additional benefits',
    transferable: true,
    refundable: true
  }),
  EARLY_BIRD: Object.freeze({
    value: 'early_bird',
    displayName: 'Early Bird',
    description: 'Discounted tickets for early purchasers',
    transferable: true,
    refundable: false
  }),
  GROUP: Object.freeze({
    value: 'group',
    displayName: 'Group Ticket',
    description: 'Ticket for group purchases',
    transferable: false,
    refundable: true
  }),
  STUDENT: Object.freeze({
    value: 'student',
    displayName: 'Student',
    description: 'Discounted ticket for students',
    transferable: false,
    refundable: true
  }),
  SPONSOR: Object.freeze({
    value: 'sponsor',
    displayName: 'Sponsor',
    description: 'Complimentary ticket for sponsors',
    transferable: false,
    refundable: false
  }),
  PRESS: Object.freeze({
    value: 'press',
    displayName: 'Press',
    description: 'Media and press passes',
    transferable: false,
    refundable: false
  })
});

/**
 * Ticket status definitions
 * @readonly
 */
const TICKET_STATUS = Object.freeze({
  ACTIVE: Object.freeze({
    value: 'active',
    displayName: 'Active',
    description: 'Ticket is valid and ready for use'
  }),
  USED: Object.freeze({
    value: 'used',
    displayName: 'Used',
    description: 'Ticket has been scanned and used'
  }),
  CANCELLED: Object.freeze({
    value: 'cancelled',
    displayName: 'Cancelled',
    description: 'Ticket has been cancelled'
  }),
  REFUNDED: Object.freeze({
    value: 'refunded',
    displayName: 'Refunded',
    description: 'Ticket has been refunded'
  }),
  TRANSFERRED: Object.freeze({
    value: 'transferred',
    displayName: 'Transferred',
    description: 'Ticket has been transferred to another user'
  }),
  EXPIRED: Object.freeze({
    value: 'expired',
    displayName: 'Expired',
    description: 'Ticket has expired'
  })
});

// =============================================================================
// BLOCKCHAIN NETWORKS AND CONTRACT ADDRESSES
// =============================================================================

/**
 * Supported blockchain networks
 * @readonly
 */
const BLOCKCHAIN_NETWORKS = Object.freeze({
  ETHEREUM_MAINNET: Object.freeze({
    name: 'ethereum',
    displayName: 'Ethereum Mainnet',
    chainId: 1,
    rpcUrl: 'https://mainnet.infura.io/v3/',
    blockExplorer: 'https://etherscan.io',
    nativeCurrency: Object.freeze({
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    })
  }),
  ETHEREUM_GOERLI: Object.freeze({
    name: 'ethereum-goerli',
    displayName: 'Ethereum Goerli Testnet',
    chainId: 5,
    rpcUrl: 'https://goerli.infura.io/v3/',
    blockExplorer: 'https://goerli.etherscan.io',
    nativeCurrency: Object.freeze({
      name: 'Goerli Ether',
      symbol: 'GoETH',
      decimals: 18
    })
  }),
  POLYGON_MAINNET: Object.freeze({
    name: 'polygon',
    displayName: 'Polygon Mainnet',
    chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    blockExplorer: 'https://polygonscan.com',
    nativeCurrency: Object.freeze({
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    })
  }),
  POLYGON_MUMBAI: Object.freeze({
    name: 'polygon-mumbai',
    displayName: 'Polygon Mumbai Testnet',
    chainId: 80001,
    rpcUrl: 'https://rpc-mumbai.maticvigil.com',
    blockExplorer: 'https://mumbai.polygonscan.com',
    nativeCurrency: Object.freeze({
      name: 'MATIC',
      symbol: 'MATIC',
      decimals: 18
    })
  }),
  BSC_MAINNET: Object.freeze({
    name: 'bsc',
    displayName: 'Binance Smart Chain',
    chainId: 56,
    rpcUrl: 'https://bsc-dataseed.binance.org',
    blockExplorer: 'https://bscscan.com',
    nativeCurrency: Object.freeze({
      name: 'BNB',
      symbol: 'BNB',
      decimals: 18
    })
  })
});

/**
 * Smart contract addresses by network
 * @readonly
 */
const CONTRACT_ADDRESSES = Object.freeze({
  ETHEREUM_MAINNET: Object.freeze({
    TICKET_NFT: '0x1234567890123456789012345678901234567890',
    EVENT_FACTORY: '0x2345678901234567890123456789012345678901',
    PAYMENT_PROCESSOR: '0x3456789012345678901234567890123456789012',
    MARKETPLACE: '0x4567890123456789012345678901234567890123'
  }),
  ETHEREUM_GOERLI: Object.freeze({
    TICKET_NFT: '0xabcdef1234567890123456789012345678901234',
    EVENT_FACTORY: '0xbcdef12345678901234567890123456789012345',
    PAYMENT_PROCESSOR: '0xcdef123456789012345678901234567890123456',
    MARKETPLACE: '0xdef1234567890123456789012345678901234567'
  }),
  POLYGON_MAINNET: Object.freeze({
    TICKET_NFT: '0x5678901234567890123456789012345678901234',
    EVENT_FACTORY: '0x6789012345678901234567890123456789012345',
    PAYMENT_PROCESSOR: '0x7890123456789012345678901234567890123456',
    MARKETPLACE: '0x8901234567890123456789012345678901234567'
  })
});

// =============================================================================
// FILE UPLOAD LIMITS AND ALLOWED TYPES
// =============================================================================

/**
 * File upload configuration
 * @readonly
 */
const FILE_UPLOAD = Object.freeze({
  MAX_FILE_SIZE: Object.freeze({
    IMAGE: 5 * 1024 * 1024, // 5MB
    DOCUMENT: 10 * 1024 * 1024, // 10MB
    VIDEO: 100 * 1024 * 1024, // 100MB
    AUDIO: 50 * 1024 * 1024, // 50MB
    GENERAL: 25 * 1024 * 1024 // 25MB
  }),
  
  ALLOWED_TYPES: Object.freeze({
    IMAGES: Object.freeze([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml'
    ]),
    DOCUMENTS: Object.freeze([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/csv'
    ]),
    VIDEOS: Object.freeze([
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/webm'
    ]),
    AUDIO: Object.freeze([
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/webm'
    ])
  }),
  
  STORAGE_PATHS: Object.freeze({
    EVENTS: 'uploads/events/',
    USERS: 'uploads/users/',
    TICKETS: 'uploads/tickets/',
    TEMP: 'uploads/temp/'
  })
});

// =============================================================================
// PAGINATION DEFAULTS AND LIMITS
// =============================================================================

/**
 * Pagination configuration
 * @readonly
 */
const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  MIN_LIMIT: 1,
  
  LIMITS: Object.freeze({
    EVENTS: 50,
    TICKETS: 100,
    USERS: 25,
    TRANSACTIONS: 50,
    NOTIFICATIONS: 30
  })
});

// =============================================================================
// CACHE TTL VALUES AND KEYS
// =============================================================================

/**
 * Cache configuration with TTL values in seconds
 * @readonly
 */
const CACHE = Object.freeze({
  TTL: Object.freeze({
    SHORT: 300, // 5 minutes
    MEDIUM: 1800, // 30 minutes
    LONG: 3600, // 1 hour
    VERY_LONG: 86400, // 24 hours
    SESSION: 604800 // 7 days
  }),
  
  KEYS: Object.freeze({
    USER_PROFILE: 'user:profile:',
    EVENT_DETAILS: 'event:details:',
    TICKET_INFO: 'ticket:info:',
    USER_PERMISSIONS: 'user:permissions:',
    EVENT_STATS: 'event:stats:',
    BLOCKCHAIN_STATUS: 'blockchain:status:',
    RATE_LIMIT: 'rate_limit:',
    SESSION: 'session:',
    EMAIL_VERIFICATION: 'email:verification:',
    PASSWORD_RESET: 'password:reset:'
  }),
  
  PREFIXES: Object.freeze({
    API: 'api:',
    WEB: 'web:',
    MOBILE: 'mobile:',
    ADMIN: 'admin:'
  })
});

// =============================================================================
// NOTIFICATION TYPES AND PRIORITIES
// =============================================================================

/**
 * Notification types and priorities
 * @readonly
 */
const NOTIFICATIONS = Object.freeze({
  TYPES: Object.freeze({
    EMAIL: Object.freeze({
      value: 'email',
      displayName: 'Email',
      enabled: true
    }),
    SMS: Object.freeze({
      value: 'sms',
      displayName: 'SMS',
      enabled: true
    }),
    PUSH: Object.freeze({
      value: 'push',
      displayName: 'Push Notification',
      enabled: true
    }),
    IN_APP: Object.freeze({
      value: 'in_app',
      displayName: 'In-App Notification',
      enabled: true
    }),
    WEBHOOK: Object.freeze({
      value: 'webhook',
      displayName: 'Webhook',
      enabled: false
    })
  }),
  
  PRIORITIES: Object.freeze({
    LOW: Object.freeze({
      value: 'low',
      displayName: 'Low',
      level: 1,
      color: '#6B7280'
    }),
    NORMAL: Object.freeze({
      value: 'normal',
      displayName: 'Normal',
      level: 2,
      color: '#3B82F6'
    }),
    HIGH: Object.freeze({
      value: 'high',
      displayName: 'High',
      level: 3,
      color: '#F59E0B'
    }),
    URGENT: Object.freeze({
      value: 'urgent',
      displayName: 'Urgent',
      level: 4,
      color: '#EF4444'
    }),
    CRITICAL: Object.freeze({
      value: 'critical',
      displayName: 'Critical',
      level: 5,
      color: '#DC2626'
    })
  }),
  
  CATEGORIES: Object.freeze({
    ACCOUNT: 'account',
    EVENT: 'event',
    TICKET: 'ticket',
    PAYMENT: 'payment',
    SECURITY: 'security',
    SYSTEM: 'system',
    MARKETING: 'marketing',
    REMINDER: 'reminder',
    ALERT: 'alert'
  }),
  
  TEMPLATES: Object.freeze({
    WELCOME: 'welcome',
    EMAIL_VERIFICATION: 'email_verification',
    PASSWORD_RESET: 'password_reset',
    TICKET_PURCHASED: 'ticket_purchased',
    EVENT_REMINDER: 'event_reminder',
    EVENT_CANCELLED: 'event_cancelled',
    PAYMENT_CONFIRMATION: 'payment_confirmation',
    REFUND_PROCESSED: 'refund_processed',
    ACCOUNT_LOCKED: 'account_locked',
    SECURITY_ALERT: 'security_alert'
  })
});

// =============================================================================
// ADDITIONAL SYSTEM CONSTANTS
// =============================================================================

/**
 * Rate limiting configuration
 * @readonly
 */
const RATE_LIMITS = Object.freeze({
  API: Object.freeze({
    REQUESTS_PER_MINUTE: 60,
    REQUESTS_PER_HOUR: 1000,
    REQUESTS_PER_DAY: 10000
  }),
  AUTH: Object.freeze({
    LOGIN_ATTEMPTS: 5,
    LOGIN_WINDOW: 900, // 15 minutes
    PASSWORD_RESET_ATTEMPTS: 3,
    PASSWORD_RESET_WINDOW: 3600 // 1 hour
  })
});

/**
 * Environment configuration
 * @readonly
 */
const ENVIRONMENTS = Object.freeze({
  DEVELOPMENT: 'development',
  STAGING: 'staging',
  PRODUCTION: 'production',
  TEST: 'test'
});

/**
 * API versions
 * @readonly
 */
const API_VERSIONS = Object.freeze({
  V1: 'v1',
  V2: 'v2',
  CURRENT: 'v1'
});

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = Object.freeze({
  HTTP_STATUS,
  ERROR_CODES,
  USER_ROLES,
  PERMISSIONS,
  EVENT_STATUS,
  TICKET_TYPES,
  TICKET_STATUS,
  BLOCKCHAIN_NETWORKS,
  CONTRACT_ADDRESSES,
  FILE_UPLOAD,
  PAGINATION,
  CACHE,
  NOTIFICATIONS,
  RATE_LIMITS,
  ENVIRONMENTS,
  API_VERSIONS
});
