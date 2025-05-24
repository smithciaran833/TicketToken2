// controllers/userController.js - Enhanced User Management API

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const { generateToken } = require('../utils/jwtUtils');
const { validateEmail, validatePassword, validateWalletAddress } = require('../utils/validators');

// @desc    Register a new user with email/password
// @route   POST /api/users/register
// @access  Public
const registerUser = async (req, res) => {
  try {
    const { username, email, password, walletAddress, displayName } = req.body;

    // Validation
    if (!email && !walletAddress) {
      return res.status(400).json({ 
        success: false,
        message: 'Either email or wallet address is required',
        errors: { email: 'Email or wallet address required' }
      });
    }

    if (email && !validateEmail(email)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid email format',
        errors: { email: 'Please provide a valid email address' }
      });
    }

    if (password && !validatePassword(password)) {
      return res.status(400).json({ 
        success: false,
        message: 'Password does not meet requirements',
        errors: { 
          password: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character'
        }
      });
    }

    if (walletAddress && !validateWalletAddress(walletAddress)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid wallet address format',
        errors: { walletAddress: 'Please provide a valid Solana wallet address' }
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [
        ...(email ? [{ email: email.toLowerCase() }] : []),
        ...(username ? [{ username: username.toLowerCase() }] : []),
        ...(walletAddress ? [{ 'walletAddresses.address': walletAddress }] : [])
      ]
    });

    if (existingUser) {
      const conflictField = existingUser.email === email?.toLowerCase() ? 'email' : 
                           existingUser.username === username?.toLowerCase() ? 'username' : 'wallet';
      return res.status(409).json({ 
        success: false,
        message: `User with this ${conflictField} already exists`,
        errors: { [conflictField]: `This ${conflictField} is already registered` }
      });
    }

    // Create unique userId
    const userId = uuidv4();

    // Create wallet object if address provided
    const walletAddresses = walletAddress 
      ? [{ address: walletAddress, isPrimary: true }] 
      : [];

    // Determine auth method
    const authMethod = walletAddress ? 'wallet' : 'email';

    // Hash password if provided
    const passwordHash = password ? await bcrypt.hash(password, 12) : undefined;

    // Create user
    const user = await User.create({
      userId,
      username: username?.toLowerCase(),
      email: email?.toLowerCase(),
      passwordHash,
      walletAddresses,
      authMethod,
      displayName: displayName || username || `User-${userId.substring(0, 8)}`,
      isEmailVerified: false,
      isActive: true,
    });

    if (user) {
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          _id: user._id,
          userId: user.userId,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          walletAddresses: user.walletAddresses,
          authMethod: user.authMethod,
          isEmailVerified: user.isEmailVerified,
          createdAt: user.createdAt,
        },
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ 
        success: false,
        message: 'Failed to create user account',
        errors: { general: 'Invalid user data provided' }
      });
    }
  } catch (error) {
    console.error('User registration error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error during registration',
      errors: { server: 'Registration service temporarily unavailable' }
    });
  }
};

// @desc    Login a user with email/password
// @route   POST /api/users/login
// @access  Public
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        message: 'Email and password are required',
        errors: { 
          email: !email ? 'Email is required' : undefined,
          password: !password ? 'Password is required' : undefined
        }
      });
    }

    // Check for user email
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials',
        errors: { email: 'No account found with this email' }
      });
    }

    if (!user.passwordHash) {
      return res.status(401).json({ 
        success: false,
        message: 'This account uses wallet authentication',
        errors: { email: 'Please connect with your wallet instead' }
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        message: 'Invalid credentials',
        errors: { password: 'Incorrect password' }
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({ 
        success: false,
        message: 'Account is deactivated',
        errors: { account: 'Please contact support to reactivate your account' }
      });
    }

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        _id: user._id,
        userId: user.userId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        walletAddresses: user.walletAddresses,
        authMethod: user.authMethod,
        isEmailVerified: user.isEmailVerified,
        lastLoginAt: user.lastLoginAt,
      },
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error('User login error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error during login',
      errors: { server: 'Login service temporarily unavailable' }
    });
  }
};

// @desc    Login or register with wallet
// @route   POST /api/users/wallet-auth
// @access  Public
const walletAuth = async (req, res) => {
  try {
    const { walletAddress, signature, message, displayName } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ 
        success: false,
        message: 'Wallet address is required',
        errors: { walletAddress: 'Please provide a wallet address' }
      });
    }

    if (!validateWalletAddress(walletAddress)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid wallet address format',
        errors: { walletAddress: 'Please provide a valid Solana wallet address' }
      });
    }

    // In production, verify the signature here
    // For now, we'll skip signature verification for development
    
    // Check if user exists
    let user = await User.findOne({ 'walletAddresses.address': walletAddress });

    if (!user) {
      // Create new user with wallet
      const userId = uuidv4();
      
      user = await User.create({
        userId,
        walletAddresses: [{ address: walletAddress, isPrimary: true }],
        authMethod: 'wallet',
        displayName: displayName || `User-${userId.substring(0, 8)}`,
        isActive: true,
      });
    } else {
      // Update last login for existing user
      user.lastLoginAt = new Date();
      await user.save();
    }

    res.json({
      success: true,
      message: user.createdAt.getTime() === user.updatedAt.getTime() ? 'Account created successfully' : 'Login successful',
      data: {
        _id: user._id,
        userId: user.userId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        walletAddresses: user.walletAddresses,
        authMethod: user.authMethod,
        lastLoginAt: user.lastLoginAt,
      },
      token: generateToken(user._id),
    });
  } catch (error) {
    console.error('Wallet auth error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error during wallet authentication',
      errors: { server: 'Wallet authentication service temporarily unavailable' }
    });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found',
        errors: { user: 'User account no longer exists' }
      });
    }

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        _id: user._id,
        userId: user.userId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        profileImage: user.profileImage,
        role: user.role,
        walletAddresses: user.walletAddresses,
        bio: user.bio,
        authMethod: user.authMethod,
        isEmailVerified: user.isEmailVerified,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error retrieving profile',
      errors: { server: 'Profile service temporarily unavailable' }
    });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found',
        errors: { user: 'User account no longer exists' }
      });
    }

    const { username, email, displayName, bio, profileImage, password, newWalletAddress } = req.body;

    // Check if username is being changed and is unique
    if (username && username.toLowerCase() !== user.username) {
      const existingUser = await User.findOne({ 
        username: username.toLowerCase(),
        _id: { $ne: user._id }
      });
      
      if (existingUser) {
        return res.status(409).json({ 
          success: false,
          message: 'Username already taken',
          errors: { username: 'This username is already in use' }
        });
      }
      user.username = username.toLowerCase();
    }

    // Check if email is being changed and is unique
    if (email && email.toLowerCase() !== user.email) {
      if (!validateEmail(email)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid email format',
          errors: { email: 'Please provide a valid email address' }
        });
      }

      const existingUser = await User.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: user._id }
      });
      
      if (existingUser) {
        return res.status(409).json({ 
          success: false,
          message: 'Email already registered',
          errors: { email: 'This email is already registered' }
        });
      }
      user.email = email.toLowerCase();
      user.isEmailVerified = false; // Reset verification status
    }

    // Update other fields
    if (displayName !== undefined) user.displayName = displayName;
    if (bio !== undefined) user.bio = bio;
    if (profileImage !== undefined) user.profileImage = profileImage;

    // Update password if provided
    if (password) {
      if (!validatePassword(password)) {
        return res.status(400).json({ 
          success: false,
          message: 'Password does not meet requirements',
          errors: { 
            password: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character'
          }
        });
      }
      user.passwordHash = await bcrypt.hash(password, 12);
    }

    // Add new wallet address if provided
    if (newWalletAddress) {
      if (!validateWalletAddress(newWalletAddress)) {
        return res.status(400).json({ 
          success: false,
          message: 'Invalid wallet address format',
          errors: { newWalletAddress: 'Please provide a valid Solana wallet address' }
        });
      }

      // Check if wallet already exists
      const walletExists = user.walletAddresses.some(w => w.address === newWalletAddress);
      if (!walletExists) {
        user.walletAddresses.push({
          address: newWalletAddress,
          isPrimary: user.walletAddresses.length === 0
        });
      }
    }

    user.updatedAt = new Date();
    const updatedUser = await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        _id: updatedUser._id,
        userId: updatedUser.userId,
        username: updatedUser.username,
        email: updatedUser.email,
        displayName: updatedUser.displayName,
        profileImage: updatedUser.profileImage,
        role: updatedUser.role,
        walletAddresses: updatedUser.walletAddresses,
        bio: updatedUser.bio,
        authMethod: updatedUser.authMethod,
        isEmailVerified: updatedUser.isEmailVerified,
        updatedAt: updatedUser.updatedAt,
      },
      token: generateToken(updatedUser._id),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error updating profile',
      errors: { server: 'Profile update service temporarily unavailable' }
    });
  }
};

// @desc    Check if username/email is available
// @route   POST /api/users/check-availability
// @access  Public
const checkAvailability = async (req, res) => {
  try {
    const { username, email } = req.body;

    if (!username && !email) {
      return res.status(400).json({ 
        success: false,
        message: 'Username or email is required',
        errors: { general: 'Please provide username or email to check' }
      });
    }

    const results = {};

    if (username) {
      const usernameExists = await User.findOne({ username: username.toLowerCase() });
      results.username = {
        available: !usernameExists,
        checked: username.toLowerCase()
      };
    }

    if (email) {
      if (!validateEmail(email)) {
        results.email = {
          available: false,
          checked: email.toLowerCase(),
          error: 'Invalid email format'
        };
      } else {
        const emailExists = await User.findOne({ email: email.toLowerCase() });
        results.email = {
          available: !emailExists,
          checked: email.toLowerCase()
        };
      }
    }

    res.json({
      success: true,
      message: 'Availability check completed',
      data: results
    });
  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal server error checking availability',
      errors: { server: 'Availability check service temporarily unavailable' }
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  walletAuth,
  getUserProfile,
  updateUserProfile,
  checkAvailability,
};
