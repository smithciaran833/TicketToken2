// controllers/walletController.js - Wallet API endpoints

const WalletService = require('../services/walletService');
const { generateToken } = require('../utils/jwtUtils');

// @desc    Generate nonce for wallet authentication
// @route   GET /api/wallet/nonce
// @access  Public
const generateNonce = async (req, res) => {
  try {
    const nonce = WalletService.generateNonce();
    
    res.json({
      success: true,
      message: 'Nonce generated successfully',
      data: { nonce }
    });
  } catch (error) {
    console.error('Generate nonce error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate nonce',
      errors: { server: 'Nonce generation service temporarily unavailable' }
    });
  }
};

// @desc    Generate authentication message for wallet
// @route   POST /api/wallet/auth-message
// @access  Public
const generateAuthMessage = async (req, res) => {
  try {
    const { walletAddress, nonce } = req.body;

    if (!walletAddress || !nonce) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address and nonce are required',
        errors: {
          walletAddress: !walletAddress ? 'Wallet address is required' : undefined,
          nonce: !nonce ? 'Nonce is required' : undefined
        }
      });
    }

    const message = WalletService.generateAuthMessage(walletAddress, nonce);

    res.json({
      success: true,
      message: 'Authentication message generated successfully',
      data: { 
        message,
        walletAddress,
        nonce 
      }
    });
  } catch (error) {
    console.error('Generate auth message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate authentication message',
      errors: { server: 'Message generation service temporarily unavailable' }
    });
  }
};

// @desc    Authenticate user with wallet signature
// @route   POST /api/wallet/authenticate
// @access  Public
const authenticateWithWallet = async (req, res) => {
  try {
    // Wallet authentication is handled by middleware
    // User is now available in req.user and req.walletAuth
    
    const { user, walletAuth } = req;
    
    res.json({
      success: true,
      message: walletAuth.isNewUser ? 'Account created successfully' : 'Authentication successful',
      data: {
        _id: user._id,
        userId: user.userId,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        walletAddresses: user.walletAddresses,
        authMethod: user.authMethod,
        isNewUser: walletAuth.isNewUser,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt
      },
      token: req.authToken
    });
  } catch (error) {
    console.error('Wallet authentication controller error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
      errors: { server: 'Authentication service temporarily unavailable' }
    });
  }
};

// @desc    Link wallet to existing user account
// @route   POST /api/wallet/link
// @access  Private
const linkWallet = async (req, res) => {
  try {
    const { walletAddress, signature, message, isPrimary } = req.body;

    // Wallet verification is handled by middleware
    // Proceed with linking
    const result = await WalletService.linkWalletToUser(
      req.user._id,
      walletAddress,
      signature,
      message,
      isPrimary
    );

    // Get updated user data
    const updatedWallets = await WalletService.getUserWallets(req.user._id);

    res.status(201).json({
      success: true,
      message: 'Wallet linked successfully',
      data: {
        ...result,
        wallets: updatedWallets.wallets,
        primaryWallet: updatedWallets.primaryWallet,
        totalWallets: updatedWallets.totalWallets
      }
    });
  } catch (error) {
    console.error('Link wallet error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to link wallet',
      errors: { wallet: error.message }
    });
  }
};

// @desc    Unlink wallet from user account
// @route   DELETE /api/wallet/unlink/:address
// @access  Private
const unlinkWallet = async (req, res) => {
  try {
    const { address } = req.params;

    const result = await WalletService.unlinkWalletFromUser(req.user._id, address);

    // Get updated user data
    const updatedWallets = await WalletService.getUserWallets(req.user._id);

    res.json({
      success: true,
      message: 'Wallet unlinked successfully',
      data: {
        ...result,
        wallets: updatedWallets.wallets,
        primaryWallet: updatedWallets.primaryWallet,
        totalWallets: updatedWallets.totalWallets
      }
    });
  } catch (error) {
    console.error('Unlink wallet error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to unlink wallet',
      errors: { wallet: error.message }
    });
  }
};

// @desc    Set primary wallet
// @route   PUT /api/wallet/primary/:address
// @access  Private
const setPrimaryWallet = async (req, res) => {
  try {
    const { address } = req.params;

    const result = await WalletService.setPrimaryWallet(req.user._id, address);

    // Get updated user data
    const updatedWallets = await WalletService.getUserWallets(req.user._id);

    res.json({
      success: true,
      message: 'Primary wallet updated successfully',
      data: {
        ...result,
        wallets: updatedWallets.wallets,
        primaryWallet: updatedWallets.primaryWallet
      }
    });
  } catch (error) {
    console.error('Set primary wallet error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to set primary wallet',
      errors: { wallet: error.message }
    });
  }
};

// @desc    Get user wallets
// @route   GET /api/wallet/list
// @access  Private
const getUserWallets = async (req, res) => {
  try {
    const walletData = await WalletService.getUserWallets(req.user._id);

    res.json({
      success: true,
      message: 'Wallet list retrieved successfully',
      data: walletData
    });
  } catch (error) {
    console.error('Get user wallets error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve wallet list',
      errors: { server: 'Wallet service temporarily unavailable' }
    });
  }
};

// @desc    Check wallet availability
// @route   POST /api/wallet/check-availability
// @access  Public
const checkWalletAvailability = async (req, res) => {
  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address is required',
        errors: { walletAddress: 'Wallet address is required' }
      });
    }

    const isAvailable = await WalletService.isWalletAvailable(walletAddress);

    res.json({
      success: true,
      message: 'Wallet availability checked successfully',
      data: {
        walletAddress,
        available: isAvailable
      }
    });
  } catch (error) {
    console.error('Check wallet availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check wallet availability',
      errors: { server: 'Availability check service temporarily unavailable' }
    });
  }
};

// @desc    Verify wallet signature
// @route   POST /api/wallet/verify
// @access  Public
const verifyWalletSignature = async (req, res) => {
  try {
    const { walletAddress, signature, message } = req.body;

    if (!walletAddress || !signature || !message) {
      return res.status(400).json({
        success: false,
        message: 'Wallet address, signature, and message are required',
        errors: {
          walletAddress: !walletAddress ? 'Wallet address is required' : undefined,
          signature: !signature ? 'Signature is required' : undefined,
          message: !message ? 'Message is required' : undefined
        }
      });
    }

    const verification = await WalletService.verifyWalletSignature(walletAddress, message, signature);

    if (verification.isValid) {
      res.json({
        success: true,
        message: 'Signature verification successful',
        data: {
          isValid: true,
          walletAddress: verification.walletAddress
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Invalid signature',
        errors: { signature: verification.error || 'Signature verification failed' }
      });
    }
  } catch (error) {
    console.error('Verify wallet signature error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify signature',
      errors: { server: 'Verification service temporarily unavailable' }
    });
  }
};

// @desc    Get wallet balance (if implemented)
// @route   GET /api/wallet/balance/:address
// @access  Private
const getWalletBalance = async (req, res) => {
  try {
    const { address } = req.params;

    // Check if user owns this wallet
    const userWallet = req.user.walletAddresses.find(w => w.address === address);
    if (!userWallet) {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
        errors: { wallet: 'You do not own this wallet' }
      });
    }

    const balance = await WalletService.getWalletBalance(address);

    res.json({
      success: true,
      message: 'Wallet balance retrieved successfully',
      data: {
        walletAddress: address,
        balance
      }
    });
  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve wallet balance',
      errors: { server: 'Balance service temporarily unavailable' }
    });
  }
};

module.exports = {
  generateNonce,
  generateAuthMessage,
  authenticateWithWallet,
  linkWallet,
  unlinkWallet,
  setPrimaryWallet,
  getUserWallets,
  checkWalletAvailability,
  verifyWalletSignature,
  getWalletBalance
};
