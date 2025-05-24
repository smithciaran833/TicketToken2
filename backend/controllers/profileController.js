// controllers/profileController.js - Dedicated profile management functions

const User = require('../models/User');
const { validateEmail, validatePassword, validateWalletAddress, validateUrl } = require('../utils/validators');
const { calculateProfileCompletion, isValidSocialHandle } = require('../utils/profileAnalytics');
const { processProfileImage, deleteProfileImage } = require('../utils/imageProcessor');
const bcrypt = require('bcryptjs');

// @desc    Get detailed user profile
// @route   GET /api/profile/detailed
// @access  Private
const getDetailedProfile = async (req, res) => {
 try {
   const user = await User.findById(req.user._id)
     .select('-passwordHash')
     .lean();

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User profile not found',
       errors: { user: 'Profile no longer exists' }
     });
   }

   // Calculate additional profile metrics
   const profileCompletion = calculateProfileCompletion(user);
   const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));

   res.json({
     success: true,
     message: 'Detailed profile retrieved successfully',
     data: {
       ...user,
       profileCompletion,
       accountAge,
       activeWallets: user.walletAddresses.length,
       primaryWallet: user.walletAddresses.find(w => w.isPrimary)?.address || null,
     }
   });
 } catch (error) {
   console.error('Get detailed profile error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to retrieve detailed profile',
     errors: { server: 'Profile service temporarily unavailable' }
   });
 }
};

// @desc    Update user preferences
// @route   PUT /api/profile/preferences
// @access  Private
const updatePreferences = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   const { notifications, privacy, language, currency, theme } = req.body;

   // Update preferences if provided
   if (notifications) {
     user.preferences.notifications = {
       ...user.preferences.notifications,
       ...notifications
     };
   }

   if (privacy) {
     user.preferences.privacy = {
       ...user.preferences.privacy,
       ...privacy
     };
   }

   if (language) {
     const validLanguages = ['en', 'es', 'fr', 'de', 'pt', 'jp', 'zh', 'ko'];
     if (!validLanguages.includes(language)) {
       return res.status(400).json({
         success: false,
         message: 'Invalid language selection',
         errors: { language: 'Please select a valid language' }
       });
     }
     user.preferences.language = language;
   }

   if (currency) {
     const validCurrencies = ['USD', 'EUR', 'GBP', 'SOL', 'BTC', 'ETH'];
     if (!validCurrencies.includes(currency)) {
       return res.status(400).json({
         success: false,
         message: 'Invalid currency selection',
         errors: { currency: 'Please select a valid currency' }
       });
     }
     user.preferences.currency = currency;
   }

   if (theme) {
     const validThemes = ['light', 'dark', 'auto'];
     if (!validThemes.includes(theme)) {
       return res.status(400).json({
         success: false,
         message: 'Invalid theme selection',
         errors: { theme: 'Please select a valid theme' }
       });
     }
     user.preferences.theme = theme;
   }

   await user.save();

   res.json({
     success: true,
     message: 'Preferences updated successfully',
     data: {
       preferences: user.preferences,
       updatedAt: user.updatedAt
     }
   });
 } catch (error) {
   console.error('Update preferences error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to update preferences',
     errors: { server: 'Preferences service temporarily unavailable' }
   });
 }
};

// @desc    Update social connections
// @route   PUT /api/profile/social
// @access  Private
const updateSocialConnections = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   const { twitter, discord, instagram, telegram, website } = req.body;
   const errors = {};

   // Validate social media handles/URLs
   if (twitter !== undefined) {
     if (twitter && !isValidSocialHandle(twitter, 'twitter')) {
       errors.twitter = 'Invalid Twitter handle or URL';
     } else {
       user.socialConnections.twitter = twitter;
     }
   }

   if (discord !== undefined) {
     if (discord && !isValidSocialHandle(discord, 'discord')) {
       errors.discord = 'Invalid Discord username';
     } else {
       user.socialConnections.discord = discord;
     }
   }

   if (instagram !== undefined) {
     if (instagram && !isValidSocialHandle(instagram, 'instagram')) {
       errors.instagram = 'Invalid Instagram handle or URL';
     } else {
       user.socialConnections.instagram = instagram;
     }
   }

   if (telegram !== undefined) {
     if (telegram && !isValidSocialHandle(telegram, 'telegram')) {
       errors.telegram = 'Invalid Telegram username';
     } else {
       user.socialConnections.telegram = telegram;
     }
   }

   if (website !== undefined) {
     if (website && !validateUrl(website)) {
       errors.website = 'Invalid website URL';
     } else {
       user.socialConnections.website = website;
     }
   }

   if (Object.keys(errors).length > 0) {
     return res.status(400).json({
       success: false,
       message: 'Invalid social media information',
       errors
     });
   }

   await user.save();

   res.json({
     success: true,
     message: 'Social connections updated successfully',
     data: {
       socialConnections: user.socialConnections,
       updatedAt: user.updatedAt
     }
   });
 } catch (error) {
   console.error('Update social connections error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to update social connections',
     errors: { server: 'Social connections service temporarily unavailable' }
   });
 }
};

// @desc    Add wallet address
// @route   POST /api/profile/wallets
// @access  Private
const addWalletAddress = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   const { walletAddress, isPrimary, signature, message } = req.body;

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

   // TODO: In production, verify the signature here
   // const isValidSignature = verifyWalletSignature(walletAddress, signature, message);
   // if (!isValidSignature) { ... }

   // Check if wallet already exists for this user
   const walletExists = user.walletAddresses.some(w => w.address === walletAddress);
   if (walletExists) {
     return res.status(409).json({
       success: false,
       message: 'Wallet address already added',
       errors: { walletAddress: 'This wallet is already linked to your account' }
     });
   }

   // Check if wallet is used by another user
   const existingUser = await User.findOne({
     'walletAddresses.address': walletAddress,
     _id: { $ne: user._id }
   });

   if (existingUser) {
     return res.status(409).json({
       success: false,
       message: 'Wallet address already in use',
       errors: { walletAddress: 'This wallet is already linked to another account' }
     });
   }

   // If setting as primary, remove primary from other wallets
   if (isPrimary) {
     user.walletAddresses.forEach(wallet => {
       wallet.isPrimary = false;
     });
   }

   // Add new wallet
   user.walletAddresses.push({
     address: walletAddress,
     isPrimary: isPrimary || user.walletAddresses.length === 0,
     addedAt: new Date(),
     verified: true // Set to true after signature verification
   });

   await user.save();

   res.status(201).json({
     success: true,
     message: 'Wallet address added successfully',
     data: {
       walletAddresses: user.walletAddresses,
       primaryWallet: user.walletAddresses.find(w => w.isPrimary)?.address || null
     }
   });
 } catch (error) {
   console.error('Add wallet address error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to add wallet address',
     errors: { server: 'Wallet service temporarily unavailable' }
   });
 }
};

// @desc    Remove wallet address
// @route   DELETE /api/profile/wallets/:address
// @access  Private
const removeWalletAddress = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);
   const { address } = req.params;

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   // Check if user has multiple wallets (prevent removing all)
   if (user.walletAddresses.length <= 1 && user.authMethod === 'wallet') {
     return res.status(400).json({
       success: false,
       message: 'Cannot remove last wallet',
       errors: { walletAddress: 'You must have at least one wallet for authentication' }
     });
   }

   // Find and remove the wallet
   const walletIndex = user.walletAddresses.findIndex(w => w.address === address);

   if (walletIndex === -1) {
     return res.status(404).json({
       success: false,
       message: 'Wallet address not found',
       errors: { walletAddress: 'This wallet is not linked to your account' }
     });
   }

   const removedWallet = user.walletAddresses[walletIndex];
   user.walletAddresses.splice(walletIndex, 1);

   // If removed wallet was primary, set another as primary
   if (removedWallet.isPrimary && user.walletAddresses.length > 0) {
     user.walletAddresses[0].isPrimary = true;
   }

   await user.save();

   res.json({
     success: true,
     message: 'Wallet address removed successfully',
     data: {
       walletAddresses: user.walletAddresses,
       primaryWallet: user.walletAddresses.find(w => w.isPrimary)?.address || null,
       removedAddress: address
     }
   });
 } catch (error) {
   console.error('Remove wallet address error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to remove wallet address',
     errors: { server: 'Wallet service temporarily unavailable' }
   });
 }
};

// @desc    Set primary wallet
// @route   PUT /api/profile/wallets/:address/primary
// @access  Private
const setPrimaryWallet = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);
   const { address } = req.params;

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   // Find the wallet to set as primary
   const walletIndex = user.walletAddresses.findIndex(w => w.address === address);

   if (walletIndex === -1) {
     return res.status(404).json({
       success: false,
       message: 'Wallet address not found',
       errors: { walletAddress: 'This wallet is not linked to your account' }
     });
   }

   // Remove primary status from all wallets
   user.walletAddresses.forEach(wallet => {
     wallet.isPrimary = false;
   });

   // Set the specified wallet as primary
   user.walletAddresses[walletIndex].isPrimary = true;

   await user.save();

   res.json({
     success: true,
     message: 'Primary wallet updated successfully',
     data: {
       walletAddresses: user.walletAddresses,
       primaryWallet: address
     }
   });
 } catch (error) {
   console.error('Set primary wallet error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to set primary wallet',
     errors: { server: 'Wallet service temporarily unavailable' }
   });
 }
};

// @desc    Change password
// @route   PUT /api/profile/password
// @access  Private
const changePassword = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);
   const { currentPassword, newPassword } = req.body;

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   // Check if user has a password (not wallet-only auth)
   if (!user.passwordHash) {
     return res.status(400).json({
       success: false,
       message: 'Account uses wallet authentication',
       errors: { password: 'This account does not have a password set' }
     });
   }

   if (!currentPassword || !newPassword) {
     return res.status(400).json({
       success: false,
       message: 'Current and new passwords are required',
       errors: {
         currentPassword: !currentPassword ? 'Current password is required' : undefined,
         newPassword: !newPassword ? 'New password is required' : undefined
       }
     });
   }

   // Verify current password
   const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
   if (!isCurrentPasswordValid) {
     return res.status(401).json({
       success: false,
       message: 'Current password is incorrect',
       errors: { currentPassword: 'Please enter your current password correctly' }
     });
   }

   // Validate new password
   if (!validatePassword(newPassword)) {
     return res.status(400).json({
       success: false,
       message: 'New password does not meet requirements',
       errors: {
         newPassword: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character'
       }
     });
   }

   // Check if new password is different from current
   const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
   if (isSamePassword) {
     return res.status(400).json({
       success: false,
       message: 'New password must be different',
       errors: { newPassword: 'Please choose a different password' }
     });
   }

   // Hash and save new password
   user.passwordHash = await bcrypt.hash(newPassword, 12);
   await user.save();

   res.json({
     success: true,
     message: 'Password changed successfully',
     data: {
       passwordChanged: true,
       updatedAt: user.updatedAt
     }
   });
 } catch (error) {
   console.error('Change password error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to change password',
     errors: { server: 'Password service temporarily unavailable' }
   });
 }
};

// @desc    Upload profile image
// @route   POST /api/profile/image
// @access  Private
const uploadProfileImage = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   if (!req.file) {
     return res.status(400).json({
       success: false,
       message: 'No image file provided',
       errors: { image: 'Please select an image to upload' }
     });
   }

   // Process the uploaded image
   const imageUrl = await processProfileImage(req.file, user._id);

   // Delete old profile image if exists
   if (user.profileImage) {
     await deleteProfileImage(user.profileImage);
   }

   // Update user profile with new image URL
   user.profileImage = imageUrl;
   await user.save();

   res.json({
     success: true,
     message: 'Profile image uploaded successfully',
     data: {
       profileImage: user.profileImage,
       updatedAt: user.updatedAt
     }
   });
 } catch (error) {
   console.error('Upload profile image error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to upload profile image',
     errors: { server: 'Image upload service temporarily unavailable' }
   });
 }
};

// @desc    Delete profile image
// @route   DELETE /api/profile/image
// @access  Private
const deleteProfileImageController = async (req, res) => {
 try {
   const user = await User.findById(req.user._id);
   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }
   if (!user.profileImage) {
     return res.status(404).json({
       success: false,
       message: 'No profile image to delete',
       errors: { image: 'User does not have a profile image' }
     });
   }
   
   // Delete the image file
   await deleteProfileImage(user.profileImage);
   
   // Remove image URL from user profile
   user.profileImage = undefined;
   await user.save();
   
   res.json({
     success: true,
     message: 'Profile image deleted successfully',
     data: {
       profileImage: null,
       updatedAt: user.updatedAt
     }
   });
 } catch (error) {
   console.error('Delete profile image error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to delete profile image',
     errors: { server: 'Image service temporarily unavailable' }
   });
 }
};

// @desc    Get profile analytics
// @route   GET /api/profile/analytics
// @access  Private
const getProfileAnalytics = async (req, res) => {
 try {
   const user = await User.findById(req.user._id)
     .select('-passwordHash')
     .lean();

   if (!user) {
     return res.status(404).json({
       success: false,
       message: 'User not found',
       errors: { user: 'User account no longer exists' }
     });
   }

   const analytics = {
     profileCompletion: calculateProfileCompletion(user),
     accountAge: Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
     lastActivity: user.lastLoginAt,
     stats: user.stats,
     connectedWallets: user.walletAddresses.length,
     socialConnections: Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length,
     accountSecurityScore: calculateSecurityScore(user)
   };

   res.json({
     success: true,
     message: 'Profile analytics retrieved successfully',
     data: analytics
   });
 } catch (error) {
   console.error('Get profile analytics error:', error);
   res.status(500).json({
     success: false,
     message: 'Failed to retrieve profile analytics',
     errors: { server: 'Analytics service temporarily unavailable' }
   });
 }
};

// Helper function to calculate security score
const calculateSecurityScore = (user) => {
 let score = 0;
 const maxScore = 100;

 // Password set (20 points)
 if (user.passwordHash) score += 20;

 // Email verified (20 points)
 if (user.isEmailVerified) score += 20;

 // Multiple wallets (15 points)
 if (user.walletAddresses.length > 1) score += 15;

 // Profile image (10 points)
 if (user.profileImage) score += 10;

 // Bio filled (10 points)
 if (user.bio && user.bio.length > 0) score += 10;

 // Social connections (15 points)
 const socialCount = Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length;
 score += Math.min(socialCount * 5, 15);

 // Recent activity (10 points)
 if (user.lastLoginAt && (Date.now() - user.lastLoginAt.getTime()) < (7 * 24 * 60 * 60 * 1000)) {
   score += 10;
 }

 return Math.min(score, maxScore);
};

module.exports = {
 getDetailedProfile,
 updatePreferences,
 updateSocialConnections,
 addWalletAddress,
 removeWalletAddress,
 setPrimaryWallet,
 changePassword,
 uploadProfileImage,
 deleteProfileImage: deleteProfileImageController,
 getProfileAnalytics,
};
