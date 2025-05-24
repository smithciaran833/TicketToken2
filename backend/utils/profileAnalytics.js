// utils/profileAnalytics.js - Profile completion tracking

// Calculate profile completion percentage
const calculateProfileCompletion = (user) => {
  if (!user) return 0;

  const weights = {
    // Basic information (40%)
    displayName: 5,
    bio: 10,
    profileImage: 15,
    email: 5,
    username: 5,
    
    // Social connections (20%)
    socialConnections: 20,
    
    // Security (25%)
    emailVerified: 10,
    passwordSet: 10,
    walletConnected: 5,
    
    // Preferences (15%)
    preferencesSet: 15
  };

  let score = 0;
  let totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

  // Basic information checks
  if (user.displayName && user.displayName.trim().length > 0) {
    score += weights.displayName;
  }
  
  if (user.bio && user.bio.trim().length >= 10) {
    score += weights.bio;
  }
  
  if (user.profileImage) {
    score += weights.profileImage;
  }
  
  if (user.email) {
    score += weights.email;
  }
  
  if (user.username) {
    score += weights.username;
  }

  // Social connections (count how many are filled)
  if (user.socialConnections) {
    const socialKeys = ['twitter', 'instagram', 'discord', 'telegram', 'website', 'linkedin', 'github'];
    const filledSocial = socialKeys.filter(key => user.socialConnections[key] && user.socialConnections[key].trim().length > 0);
    const socialPercentage = Math.min(filledSocial.length / 3, 1); // Max score if 3+ social connections
    score += weights.socialConnections * socialPercentage;
  }

  // Security checks
  if (user.isEmailVerified) {
    score += weights.emailVerified;
  }
  
  if (user.passwordHash) {
    score += weights.passwordSet;
  }
  
  if (user.walletAddresses && user.walletAddresses.length > 0) {
    score += weights.walletConnected;
  }

  // Preferences (check if user has customized preferences)
  if (user.preferences) {
    const hasCustomPreferences = 
      user.preferences.language !== 'en' ||
      user.preferences.currency !== 'USD' ||
      user.preferences.theme !== 'light' ||
      Object.values(user.preferences.notifications || {}).some(val => val === false) ||
      Object.values(user.preferences.privacy || {}).some(val => val !== undefined);
    
    if (hasCustomPreferences) {
      score += weights.preferencesSet;
    }
  }

  return Math.round((score / totalWeight) * 100);
};

// Get profile completion breakdown
const getProfileCompletionBreakdown = (user) => {
  const breakdown = {
    sections: {
      basicInfo: {
        score: 0,
        maxScore: 40,
        items: {
          displayName: { completed: false, weight: 5 },
          bio: { completed: false, weight: 10 },
          profileImage: { completed: false, weight: 15 },
          email: { completed: false, weight: 5 },
          username: { completed: false, weight: 5 }
        }
      },
      socialConnections: {
        score: 0,
        maxScore: 20,
        items: {
          socialProfiles: { completed: false, weight: 20 }
        }
      },
      security: {
        score: 0,
        maxScore: 25,
        items: {
          emailVerified: { completed: false, weight: 10 },
          passwordSet: { completed: false, weight: 10 },
          walletConnected: { completed: false, weight: 5 }
        }
      },
      preferences: {
        score: 0,
        maxScore: 15,
        items: {
          customPreferences: { completed: false, weight: 15 }
        }
      }
    },
    recommendations: []
  };

  // Basic information
  if (user.displayName && user.displayName.trim().length > 0) {
    breakdown.sections.basicInfo.items.displayName.completed = true;
    breakdown.sections.basicInfo.score += 5;
  } else {
    breakdown.recommendations.push({
      type: 'displayName',
      title: 'Add Display Name',
      description: 'Set a display name for your profile',
      priority: 'medium'
    });
  }

  if (user.bio && user.bio.trim().length >= 10) {
    breakdown.sections.basicInfo.items.bio.completed = true;
    breakdown.sections.basicInfo.score += 10;
  } else {
    breakdown.recommendations.push({
      type: 'bio',
      title: 'Write Bio',
      description: 'Tell others about yourself with a compelling bio',
      priority: 'medium'
    });
  }

  if (user.profileImage) {
    breakdown.sections.basicInfo.items.profileImage.completed = true;
    breakdown.sections.basicInfo.score += 15;
  } else {
    breakdown.recommendations.push({
      type: 'profileImage',
      title: 'Upload Profile Picture',
      description: 'Add a profile picture to personalize your account',
      priority: 'high'
    });
  }

  if (user.email) {
    breakdown.sections.basicInfo.items.email.completed = true;
    breakdown.sections.basicInfo.score += 5;
  }

  if (user.username) {
    breakdown.sections.basicInfo.items.username.completed = true;
    breakdown.sections.basicInfo.score += 5;
  }

  // Social connections
  if (user.socialConnections) {
    const socialKeys = ['twitter', 'instagram', 'discord', 'telegram', 'website', 'linkedin', 'github'];
    const filledSocial = socialKeys.filter(key => user.socialConnections[key] && user.socialConnections[key].trim().length > 0);
    
    if (filledSocial.length >= 3) {
      breakdown.sections.socialConnections.items.socialProfiles.completed = true;
      breakdown.sections.socialConnections.score += 20;
    } else {
      breakdown.sections.socialConnections.score += Math.round((filledSocial.length / 3) * 20);
      breakdown.recommendations.push({
        type: 'socialConnections',
        title: 'Connect Social Media',
        description: `Connect ${3 - filledSocial.length} more social profiles`,
        priority: 'low'
      });
    }
  } else {
    breakdown.recommendations.push({
      type: 'socialConnections',
      title: 'Connect Social Media',
      description: 'Link your social media profiles to connect with others',
      priority: 'low'
    });
  }

  // Security
  if (user.isEmailVerified) {
    breakdown.sections.security.items.emailVerified.completed = true;
    breakdown.sections.security.score += 10;
  } else if (user.email) {
    breakdown.recommendations.push({
      type: 'emailVerification',
      title: 'Verify Email',
      description: 'Verify your email address for account security',
      priority: 'high'
    });
  }

  if (user.passwordHash) {
    breakdown.sections.security.items.passwordSet.completed = true;
    breakdown.sections.security.score += 10;
  } else if (user.authMethod !== 'wallet') {
    breakdown.recommendations.push({
      type: 'password',
      title: 'Set Password',
      description: 'Set a strong password for account security',
      priority: 'high'
    });
  }

  if (user.walletAddresses && user.walletAddresses.length > 0) {
    breakdown.sections.security.items.walletConnected.completed = true;
    breakdown.sections.security.score += 5;
  } else {
    breakdown.recommendations.push({
      type: 'wallet',
      title: 'Connect Wallet',
      description: 'Connect your Solana wallet to access all features',
      priority: 'high'
    });
  }

  // Preferences
  if (user.preferences) {
    const hasCustomPreferences = 
      user.preferences.language !== 'en' ||
      user.preferences.currency !== 'USD' ||
      user.preferences.theme !== 'light' ||
      Object.values(user.preferences.notifications || {}).some(val => val === false) ||
      Object.values(user.preferences.privacy || {}).some(val => val !== undefined);
    
    if (hasCustomPreferences) {
      breakdown.sections.preferences.items.customPreferences.completed = true;
      breakdown.sections.preferences.score += 15;
    } else {
      breakdown.recommendations.push({
        type: 'preferences',
        title: 'Customize Preferences',
        description: 'Set your notification and privacy preferences',
        priority: 'low'
      });
    }
  }

  // Calculate overall score
  breakdown.overallScore = Object.values(breakdown.sections).reduce((total, section) => total + section.score, 0);
  breakdown.maxScore = Object.values(breakdown.sections).reduce((total, section) => total + section.maxScore, 0);
  breakdown.completionPercentage = Math.round((breakdown.overallScore / breakdown.maxScore) * 100);

  // Sort recommendations by priority
  const priorityOrder = { high: 3, medium: 2, low: 1 };
  breakdown.recommendations.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);

  return breakdown;
};

// Get profile strength indicators
const getProfileStrength = (user) => {
  const indicators = {
    weak: [],
    moderate: [],
    strong: []
  };

  const completion = calculateProfileCompletion(user);
  
  // Weak indicators (red flags)
  if (!user.profileImage) indicators.weak.push('Missing profile picture');
  if (!user.bio || user.bio.length < 10) indicators.weak.push('No bio or bio too short');
  if (!user.isEmailVerified && user.email) indicators.weak.push('Email not verified');
  if (!user.passwordHash && user.authMethod !== 'wallet') indicators.weak.push('No password set');
  
  // Moderate indicators (yellow flags)
  if (user.walletAddresses && user.walletAddresses.length === 0) indicators.moderate.push('No wallet connected');
  if (!user.socialConnections || Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length === 0) {
    indicators.moderate.push('No social connections');
  }
  if (!user.username) indicators.moderate.push('No username set');
  
  // Strong indicators (green flags)
  if (user.isEmailVerified) indicators.strong.push('Email verified');
  if (user.walletAddresses && user.walletAddresses.length > 1) indicators.strong.push('Multiple wallets connected');
  if (user.socialConnections && Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length >= 3) {
    indicators.strong.push('Multiple social connections');
  }
  if (user.bio && user.bio.length >= 50) indicators.strong.push('Detailed bio');
  if (completion >= 80) indicators.strong.push('Profile highly complete');

  return {
    indicators,
    strength: completion >= 80 ? 'strong' : completion >= 50 ? 'moderate' : 'weak',
    score: completion
  };
};

// Generate profile insights
const generateProfileInsights = (user) => {
  const completion = calculateProfileCompletion(user);
  const breakdown = getProfileCompletionBreakdown(user);
  const strength = getProfileStrength(user);
  
  const insights = {
    completion,
    breakdown,
    strength,
    achievements: getProfileAchievements(user),
    suggestions: getImprovementSuggestions(user),
    stats: {
      daysSinceCreation: Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      lastActivity: user.lastLoginAt ? Math.floor((Date.now() - user.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24)) : null,
      profileViews: user.stats?.profileViews || 0
    }
  };

  return insights;
};

// Get profile achievements
const getProfileAchievements = (user) => {
  const achievements = [];
  const completion = calculateProfileCompletion(user);
  
  // Completion achievements
  if (completion >= 100) achievements.push({ type: 'completion', title: 'Profile Master', description: '100% profile completion', icon: '🏆' });
  else if (completion >= 75) achievements.push({ type: 'completion', title: 'Almost There', description: '75% profile completion', icon: '🎯' });
  else if (completion >= 50) achievements.push({ type: 'completion', title: 'Halfway Hero', description: '50% profile completion', icon: '⭐' });
  
  // Social achievements
  if (user.socialConnections) {
    const socialCount = Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length;
    if (socialCount >= 5) achievements.push({ type: 'social', title: 'Social Butterfly', description: '5+ social connections', icon: '🦋' });
    else if (socialCount >= 3) achievements.push({ type: 'social', title: 'Social Climber', description: '3+ social connections', icon: '🌐' });
  }
  
  // Security achievements
  if (user.isEmailVerified && user.passwordHash && user.walletAddresses?.length > 0) {
    achievements.push({ type: 'security', title: 'Security Champion', description: 'Email verified, password set, wallet connected', icon: '🛡️' });
  }
  
  // Wallet achievements
  if (user.walletAddresses && user.walletAddresses.length >= 3) {
    achievements.push({ type: 'wallet', title: 'Wallet Collector', description: '3+ wallets connected', icon: '👛' });
  }
  
  // Longevity achievements
  const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  if (accountAge >= 365) achievements.push({ type: 'longevity', title: 'Veteran User', description: '1+ year account', icon: '🎖️' });
  else if (accountAge >= 30) achievements.push({ type: 'longevity', title: 'Regular User', description: '30+ days account', icon: '📅' });
  
  return achievements;
};

// Get improvement suggestions
const getImprovementSuggestions = (user) => {
  const suggestions = [];
  const completion = calculateProfileCompletion(user);
  
  // Priority suggestions based on missing elements
  if (!user.profileImage) {
    suggestions.push({
      type: 'critical',
      action: 'Upload profile picture',
      impact: 'High',
      description: 'A profile picture makes your account more trustworthy and personal'
    });
  }
  
  if (!user.bio || user.bio.length < 10) {
    suggestions.push({
      type: 'high',
      action: 'Write a bio',
      impact: 'Medium',
      description: 'Tell others about yourself to build connections'
    });
  }
  
  if (!user.isEmailVerified && user.email) {
    suggestions.push({
      type: 'critical',
      action: 'Verify email address',
      impact: 'High',
      description: 'Email verification improves account security and enables important notifications'
    });
  }
  
  if (!user.walletAddresses || user.walletAddresses.length === 0) {
    suggestions.push({
      type: 'high',
      action: 'Connect a wallet',
      impact: 'High',
      description: 'Connect your Solana wallet to access all features'
    });
  }
  
  if (!user.socialConnections || Object.keys(user.socialConnections).filter(key => user.socialConnections[key]).length === 0) {
    suggestions.push({
      type: 'medium',
      action: 'Add social connections',
      impact: 'Medium',
      description: 'Connect social media profiles to build your network'
    });
  }
  
  return suggestions;
};

// Helper function to validate social media handle
const isValidSocialHandle = (handle, platform) => {
  const patterns = {
    twitter: /^@?[A-Za-z0-9_]{1,15}$|^https?:\/\/(www\.)?(twitter\.com|x\.com)\/[A-Za-z0-9_]{1,15}\/?$/,
    instagram: /^@?[A-Za-z0-9_.]{1,30}$|^https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]{1,30}\/?$/,
    discord: /^.{3,32}#[0-9]{4}$|^@?[A-Za-z0-9_.]{2,32}$/,
    telegram: /^@?[A-Za-z0-9_]{5,32}$|^https?:\/\/(www\.)?t\.me\/[A-Za-z0-9_]{5,32}\/?$/,
    linkedin: /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[A-Za-z0-9\-\.]+\/?$/,
    github: /^@?[A-Za-z0-9\-]{1,39}$|^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9\-]{1,39}\/?$/
  };

  return patterns[platform] ? patterns[platform].test(handle) : false;
};

module.exports = {
  calculateProfileCompletion,
  getProfileCompletionBreakdown,
  getProfileStrength,
  generateProfileInsights,
  getProfileAchievements,
  getImprovementSuggestions,
  isValidSocialHandle,
};
