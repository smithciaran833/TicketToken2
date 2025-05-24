const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { PublicKey } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const User = require('../models/User');
const { sendEmail } = require('./emailService');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

class AuthService {
  constructor() {
    // Rate limiting for login attempts
    this.loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per window
      message: 'Too many login attempts, please try again later',
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res) => {
        logger.warn('Rate limit exceeded for login', {
          ip: req.ip,
          email: req.body.email
        });
        throw new AppError('Too many login attempts, please try again later', 429);
      }
    });

    // Rate limiting for registration
    this.registerLimiter = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 registrations per hour per IP
      message: 'Too many registration attempts, please try again later'
    });

    // Rate limiting for password reset requests
    this.passwordResetLimiter = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 password reset requests per hour per IP
      message: 'Too many password reset attempts, please try again later'
    });
  }

  /**
   * Register a new user with email/password
   * @param {Object} userData - User registration data
   * @returns {Object} - User data and tokens
   */
  async register(userData) {
    try {
      const { email, password, firstName, lastName } = userData;

      // Validate input
      if (!email || !password || !firstName || !lastName) {
        throw new AppError('All fields are required', 400);
      }

      // Check if user already exists
      const existingUser = await User.findOne({ 
        $or: [
          { email: email.toLowerCase() },
          { 'wallet.address': userData.walletAddress }
        ]
      });

      if (existingUser) {
        if (existingUser.email === email.toLowerCase()) {
          throw new AppError('User with this email already exists', 409);
        }
        if (existingUser.wallet?.address === userData.walletAddress) {
          throw new AppError('User with this wallet address already exists', 409);
        }
      }

      // Validate password strength
      if (password.length < 8) {
        throw new AppError('Password must be at least 8 characters long', 400);
      }

      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
        throw new AppError('Password must contain at least one uppercase letter, one lowercase letter, and one number', 400);
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Generate email verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create user
      const user = new User({
        email: email.toLowerCase(),
        password: hashedPassword,
        firstName,
        lastName,
        emailVerificationToken,
        emailVerificationExpires,
        isEmailVerified: false,
        wallet: userData.walletAddress ? {
          address: userData.walletAddress,
          isVerified: false
        } : undefined,
        registrationDate: new Date(),
        lastLogin: null,
        loginAttempts: 0,
        lockUntil: null
      });

      await user.save();

      // Send verification email
      try {
        await this.sendVerificationEmail(user.email, emailVerificationToken);
        logger.info('Verification email sent', { email: user.email });
      } catch (emailError) {
        logger.error('Failed to send verification email', {
          email: user.email,
          error: emailError.message
        });
        // Don't fail registration if email fails
      }

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user._id);

      // Store refresh token
      user.refreshTokens = user.refreshTokens || [];
      user.refreshTokens.push({
        token: refreshToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });
      await user.save();

      logger.info('User registered successfully', {
        userId: user._id,
        email: user.email,
        hasWallet: !!userData.walletAddress
      });

      return {
        user: this.sanitizeUser(user),
        accessToken,
        refreshToken,
        message: 'Registration successful. Please check your email to verify your account.'
      };

    } catch (error) {
      logger.error('Registration failed', {
        email: userData.email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Login with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Object} - User data and tokens
   */
  async login(email, password) {
    try {
      if (!email || !password) {
        throw new AppError('Email and password are required', 400);
      }

      // Find user
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        throw new AppError('Invalid credentials', 401);
      }

      // Check if account is locked
      if (user.lockUntil && user.lockUntil > Date.now()) {
        const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
        throw new AppError(`Account is locked. Try again in ${lockTimeRemaining} minutes.`, 423);
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        // Increment login attempts
        user.loginAttempts = (user.loginAttempts || 0) + 1;
        
        // Lock account after 5 failed attempts
        if (user.loginAttempts >= 5) {
          user.lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
          logger.warn('Account locked due to multiple failed login attempts', {
            email: user.email,
            attempts: user.loginAttempts
          });
        }
        
        await user.save();
        throw new AppError('Invalid credentials', 401);
      }

      // Reset login attempts on successful login
      if (user.loginAttempts > 0) {
        user.loginAttempts = 0;
        user.lockUntil = null;
      }

      // Update last login
      user.lastLogin = new Date();

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user._id);

      // Store refresh token
      user.refreshTokens = user.refreshTokens || [];
      user.refreshTokens.push({
        token: refreshToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });

      // Clean up old refresh tokens
      user.refreshTokens = user.refreshTokens.filter(
        tokenObj => tokenObj.expiresAt > new Date()
      );

      await user.save();

      logger.info('User logged in successfully', {
        userId: user._id,
        email: user.email
      });

      return {
        user: this.sanitizeUser(user),
        accessToken,
        refreshToken
      };

    } catch (error) {
      logger.error('Login failed', {
        email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Authenticate user with Solana wallet
   * @param {string} walletAddress - Solana wallet address
   * @param {string} signature - Signed message signature
   * @param {string} message - Original message that was signed
   * @returns {Object} - User data and tokens
   */
  async authenticateWallet(walletAddress, signature, message) {
    try {
      if (!walletAddress || !signature || !message) {
        throw new AppError('Wallet address, signature, and message are required', 400);
      }

      // Verify the signature
      const isValidSignature = this.verifyWalletSignature(walletAddress, signature, message);
      if (!isValidSignature) {
        throw new AppError('Invalid wallet signature', 401);
      }

      // Check if message is recent (within 5 minutes) to prevent replay attacks
      const messageTimestamp = this.extractTimestampFromMessage(message);
      if (!messageTimestamp || Date.now() - messageTimestamp > 5 * 60 * 1000) {
        throw new AppError('Message timestamp is too old or invalid', 401);
      }

      // Find or create user
      let user = await User.findOne({ 'wallet.address': walletAddress });
      
      if (!user) {
        // Create new user with wallet
        user = new User({
          wallet: {
            address: walletAddress,
            isVerified: true
          },
          registrationDate: new Date(),
          lastLogin: new Date(),
          isEmailVerified: false // Will be false until they add and verify email
        });
        
        logger.info('New wallet user created', { walletAddress });
      } else {
        // Update existing user
        user.wallet.isVerified = true;
        user.lastLogin = new Date();
        
        logger.info('Existing wallet user authenticated', {
          userId: user._id,
          walletAddress
        });
      }

      // Generate tokens
      const { accessToken, refreshToken } = this.generateTokens(user._id);

      // Store refresh token
      user.refreshTokens = user.refreshTokens || [];
      user.refreshTokens.push({
        token: refreshToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      });

      await user.save();

      return {
        user: this.sanitizeUser(user),
        accessToken,
        refreshToken,
        isNewUser: !user.email // Consider user new if they don't have email set
      };

    } catch (error) {
      logger.error('Wallet authentication failed', {
        walletAddress,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Valid refresh token
   * @returns {Object} - New tokens
   */
  async refreshToken(refreshToken) {
    try {
      if (!refreshToken) {
        throw new AppError('Refresh token is required', 400);
      }

      // Verify refresh token
      let decoded;
      try {
        decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      } catch (jwtError) {
        throw new AppError('Invalid or expired refresh token', 401);
      }

      // Find user and validate refresh token
      const user = await User.findById(decoded.userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      const storedTokenIndex = user.refreshTokens?.findIndex(
        tokenObj => tokenObj.token === refreshToken && tokenObj.expiresAt > new Date()
      );

      if (storedTokenIndex === -1) {
        throw new AppError('Invalid or expired refresh token', 401);
      }

      // Generate new tokens
      const { accessToken, refreshToken: newRefreshToken } = this.generateTokens(user._id);

      // Replace old refresh token with new one
      user.refreshTokens[storedTokenIndex] = {
        token: newRefreshToken,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      };

      await user.save();

      logger.info('Tokens refreshed successfully', { userId: user._id });

      return {
        accessToken,
        refreshToken: newRefreshToken
      };

    } catch (error) {
      logger.error('Token refresh failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Verify email with verification token
   * @param {string} token - Email verification token
   * @returns {Object} - Success message
   */
  async verifyEmail(token) {
    try {
      if (!token) {
        throw new AppError('Verification token is required', 400);
      }

      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: Date.now() }
      });

      if (!user) {
        throw new AppError('Invalid or expired verification token', 400);
      }

      // Update user
      user.isEmailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      
      await user.save();

      logger.info('Email verified successfully', {
        userId: user._id,
        email: user.email
      });

      return {
        message: 'Email verified successfully'
      };

    } catch (error) {
      logger.error('Email verification failed', {
        token,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Request password reset
   * @param {string} email - User email
   * @returns {Object} - Success message
   */
  async requestPasswordReset(email) {
    try {
      if (!email) {
        throw new AppError('Email is required', 400);
      }

      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        // Don't reveal if user exists or not
        return { message: 'If an account with that email exists, a password reset link has been sent.' };
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      user.passwordResetToken = resetToken;
      user.passwordResetExpires = resetTokenExpires;
      await user.save();

      // Send reset email
      try {
        await this.sendPasswordResetEmail(user.email, resetToken);
        logger.info('Password reset email sent', { email: user.email });
      } catch (emailError) {
        logger.error('Failed to send password reset email', {
          email: user.email,
          error: emailError.message
        });
        throw new AppError('Failed to send password reset email', 500);
      }

      return {
        message: 'If an account with that email exists, a password reset link has been sent.'
      };

    } catch (error) {
      logger.error('Password reset request failed', {
        email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Reset password with token
   * @param {string} token - Password reset token
   * @param {string} newPassword - New password
   * @returns {Object} - Success message
   */
  async resetPassword(token, newPassword) {
    try {
      if (!token || !newPassword) {
        throw new AppError('Token and new password are required', 400);
      }

      // Validate password strength
      if (newPassword.length < 8) {
        throw new AppError('Password must be at least 8 characters long', 400);
      }

      if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
        throw new AppError('Password must contain at least one uppercase letter, one lowercase letter, and one number', 400);
      }

      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: Date.now() }
      });

      if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      // Hash new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user
      user.password = hashedPassword;
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      user.loginAttempts = 0; // Reset login attempts
      user.lockUntil = null; // Remove any account lock
      
      // Invalidate all refresh tokens for security
      user.refreshTokens = [];
      
      await user.save();

      logger.info('Password reset successfully', {
        userId: user._id,
        email: user.email
      });

      return {
        message: 'Password reset successfully'
      };

    } catch (error) {
      logger.error('Password reset failed', {
        token,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Remove sensitive fields from user object
   * @param {Object} user - User object
   * @returns {Object} - Sanitized user object
   */
  sanitizeUser(user) {
    const userObj = user.toObject ? user.toObject() : user;
    
    // Remove sensitive fields
    delete userObj.password;
    delete userObj.emailVerificationToken;
    delete userObj.emailVerificationExpires;
    delete userObj.passwordResetToken;
    delete userObj.passwordResetExpires;
    delete userObj.refreshTokens;
    delete userObj.loginAttempts;
    delete userObj.lockUntil;
    delete userObj.__v;

    return userObj;
  }

  /**
   * Verify Solana wallet signature
   * @param {string} walletAddress - Solana wallet address
   * @param {string} signature - Signature to verify
   * @param {string} message - Original message that was signed
   * @returns {boolean} - True if signature is valid
   */
  verifyWalletSignature(walletAddress, signature, message) {
    try {
      // Convert wallet address to PublicKey
      const publicKey = new PublicKey(walletAddress);
      
      // Decode signature and message
      const signatureBytes = bs58.decode(signature);
      const messageBytes = new TextEncoder().encode(message);
      
      // Verify signature using nacl
      return nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKey.toBytes()
      );
    } catch (error) {
      logger.error('Wallet signature verification failed', {
        walletAddress,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Generate JWT tokens
   * @param {string} userId - User ID
   * @returns {Object} - Access and refresh tokens
   */
  generateTokens(userId) {
    const accessToken = jwt.sign(
      { userId },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { userId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Extract timestamp from signed message
   * @param {string} message - Signed message
   * @returns {number|null} - Timestamp or null if not found
   */
  extractTimestampFromMessage(message) {
    try {
      const match = message.match(/timestamp:\s*(\d+)/i);
      return match ? parseInt(match[1]) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Send verification email
   * @param {string} email - User email
   * @param {string} token - Verification token
   */
  async sendVerificationEmail(email, token) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    
    const emailContent = {
      to: email,
      subject: 'Verify Your Email Address',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2>Verify Your Email Address</h2>
          <p>Thank you for registering! Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
          <p><small>This link will expire in 24 hours.</small></p>
        </div>
      `
    };

    await sendEmail(emailContent);
  }

  /**
   * Send password reset email
   * @param {string} email - User email
   * @param {string} token - Reset token
   */
  async sendPasswordResetEmail(email, token) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const emailContent = {
      to: email,
      subject: 'Password Reset Request',
      html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: Arial, sans-serif;">
          <h2>Password Reset Request</h2>
          <p>You requested a password reset. Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #dc3545; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${resetUrl}</p>
          <p><small>This link will expire in 1 hour. If you didn't request this reset, please ignore this email.</small></p>
        </div>
      `
    };

    await sendEmail(emailContent);
  }

  /**
   * Logout user by invalidating refresh token
   * @param {string} refreshToken - Refresh token to invalidate
   * @param {string} userId - User ID
   */
  async logout(refreshToken, userId) {
    try {
      const user = await User.findById(userId);
      if (user && user.refreshTokens) {
        user.refreshTokens = user.refreshTokens.filter(
          tokenObj => tokenObj.token !== refreshToken
        );
        await user.save();
      }

      logger.info('User logged out successfully', { userId });
    } catch (error) {
      logger.error('Logout failed', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Logout from all devices by clearing all refresh tokens
   * @param {string} userId - User ID
   */
  async logoutAll(userId) {
    try {
      const user = await User.findById(userId);
      if (user) {
        user.refreshTokens = [];
        await user.save();
      }

      logger.info('User logged out from all devices', { userId });
    } catch (error) {
      logger.error('Logout all failed', { userId, error: error.message });
      throw error;
    }
  }
}

module.exports = new AuthService();
