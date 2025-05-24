// tests/profile.test.js - Profile management tests

const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const app = require('../server');
const User = require('../models/User');

// Test database setup
const MONGODB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/tickettoken_test';

describe('Profile Management Endpoints', () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI);
  });

  beforeEach(async () => {
    await User.deleteMany({});
    
    // Create and login a test user
    const userData = {
      username: 'testuser',
      email: 'test@example.com',
      password: 'TestPass123!',
      displayName: 'Test User'
    };

    const res = await request(app)
      .post('/api/users/register')
      .send(userData);

    authToken = res.body.token;
    testUser = res.body.data;
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  describe('GET /api/profile/detailed', () => {
    it('should get detailed profile information', async () => {
      const res = await request(app)
        .get('/api/profile/detailed')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('profileCompletion');
      expect(res.body.data).toHaveProperty('accountAge');
      expect(res.body.data).toHaveProperty('securityScore');
      expect(res.body.data.email).toBe('test@example.com');
    });

    it('should return error without authentication', async () => {
      const res = await request(app)
        .get('/api/profile/detailed')
        .expect(401);

      expect(res.body.success).toBe(false);
    });
  });

  describe('PUT /api/profile/preferences', () => {
    it('should update user preferences', async () => {
      const preferences = {
        notifications: {
          email: false,
          push: true,
          marketing: false
        },
        language: 'es',
        currency: 'EUR'
      };

      const res = await request(app)
        .put('/api/profile/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send(preferences)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.preferences.language).toBe('es');
      expect(res.body.data.preferences.currency).toBe('EUR');
      expect(res.body.data.preferences.notifications.email).toBe(false);
    });

    it('should reject invalid language', async () => {
      const preferences = {
        language: 'invalid_lang'
      };

      const res = await request(app)
        .put('/api/profile/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .send(preferences)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.language).toBeDefined();
    });
  });

  describe('PUT /api/profile/social', () => {
    it('should update social connections', async () => {
      const socialData = {
        twitter: '@testuser',
        instagram: 'testuser123',
        website: 'https://testuser.com'
      };

      const res = await request(app)
        .put('/api/profile/social')
        .set('Authorization', `Bearer ${authToken}`)
        .send(socialData)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.socialConnections.twitter).toBe('@testuser');
      expect(res.body.data.socialConnections.website).toBe('https://testuser.com');
    });

    it('should reject invalid social handles', async () => {
      const socialData = {
        twitter: 'invalid_twitter_handle_too_long_for_validation',
        website: 'not_a_valid_url'
      };

      const res = await request(app)
        .put('/api/profile/social')
        .set('Authorization', `Bearer ${authToken}`)
        .send(socialData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors).toHaveProperty('twitter');
      expect(res.body.errors).toHaveProperty('website');
    });
  });

  describe('POST /api/profile/wallets', () => {
    it('should add a new wallet address', async () => {
      const walletData = {
        walletAddress: '11111111111111111111111111111113',
        isPrimary: false
      };

      const res = await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send(walletData)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.walletAddresses).toHaveLength(1);
      expect(res.body.data.walletAddresses[0].address).toBe(walletData.walletAddress);
    });

    it('should reject invalid wallet address', async () => {
      const walletData = {
        walletAddress: 'invalid_wallet_address'
      };

      const res = await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send(walletData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.walletAddress).toBeDefined();
    });

    it('should reject duplicate wallet address', async () => {
      const walletData = {
        walletAddress: '11111111111111111111111111111113'
      };

      // Add wallet first time
      await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send(walletData)
        .expect(201);

      // Try to add same wallet again
      const res = await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send(walletData)
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.walletAddress).toBeDefined();
    });
  });

  describe('DELETE /api/profile/wallets/:address', () => {
    beforeEach(async () => {
      // Add a wallet first
      await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ walletAddress: '11111111111111111111111111111113' });
    });

    it('should remove wallet address', async () => {
      const res = await request(app)
        .delete('/api/profile/wallets/11111111111111111111111111111113')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.walletAddresses).toHaveLength(0);
      expect(res.body.data.removedAddress).toBe('11111111111111111111111111111113');
    });

    it('should return error for non-existent wallet', async () => {
      const res = await request(app)
        .delete('/api/profile/wallets/nonexistentwallet')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.walletAddress).toBeDefined();
    });
  });

  describe('PUT /api/profile/wallets/:address/primary', () => {
    beforeEach(async () => {
      // Add two wallets
      await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ walletAddress: '11111111111111111111111111111113' });
      
      await request(app)
        .post('/api/profile/wallets')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ walletAddress: '11111111111111111111111111111114' });
    });

    it('should set wallet as primary', async () => {
      const res = await request(app)
        .put('/api/profile/wallets/11111111111111111111111111111114/primary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.primaryWallet).toBe('11111111111111111111111111111114');
      
      // Check that only one wallet is primary
      const primaryWallets = res.body.data.walletAddresses.filter(w => w.isPrimary);
      expect(primaryWallets).toHaveLength(1);
    });
  });

  describe('PUT /api/profile/password', () => {
    it('should change password successfully', async () => {
      const passwordData = {
        currentPassword: 'TestPass123!',
        newPassword: 'NewPass456@'
      };

      const res = await request(app)
        .put('/api/profile/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send(passwordData)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.passwordChanged).toBe(true);

      // Test login with new password
      const loginRes = await request(app)
        .post('/api/users/login')
        .send({
          email: 'test@example.com',
          password: 'NewPass456@'
        })
        .expect(200);

      expect(loginRes.body.success).toBe(true);
    });

    it('should reject incorrect current password', async () => {
      const passwordData = {
        currentPassword: 'WrongPassword',
        newPassword: 'NewPass456@'
      };

      const res = await request(app)
        .put('/api/profile/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send(passwordData)
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.currentPassword).toBeDefined();
    });

    it('should reject weak new password', async () => {
      const passwordData = {
        currentPassword: 'TestPass123!',
        newPassword: 'weak'
      };

      const res = await request(app)
        .put('/api/profile/password')
        .set('Authorization', `Bearer ${authToken}`)
        .send(passwordData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.newPassword).toBeDefined();
    });
  });

  describe('POST /api/profile/image', () => {
    it('should upload profile image', async () => {
      // Create a simple test image buffer
      const testImageBuffer = Buffer.from('fake-image-data');
      
      const res = await request(app)
        .post('/api/profile/image')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profileImage', testImageBuffer, 'test.jpg')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.profileImage).toBeDefined();
    });

    it('should reject non-image files', async () => {
      const testFileBuffer = Buffer.from('not-an-image');
      
      const res = await request(app)
        .post('/api/profile/image')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profileImage', testFileBuffer, 'test.txt')
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.image).toBeDefined();
    });
  });

  describe('GET /api/profile/analytics', () => {
    it('should get profile analytics', async () => {
      const res = await request(app)
        .get('/api/profile/analytics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('profileCompletion');
      expect(res.body.data).toHaveProperty('accountAge');
      expect(res.body.data).toHaveProperty('accountSecurityScore');
      expect(res.body.data).toHaveProperty('stats');
    });
  });

  describe('DELETE /api/profile/image', () => {
    beforeEach(async () => {
      // Upload an image first
      const testImageBuffer = Buffer.from('fake-image-data');
      await request(app)
        .post('/api/profile/image')
        .set('Authorization', `Bearer ${authToken}`)
        .attach('profileImage', testImageBuffer, 'test.jpg');
    });

    it('should delete profile image', async () => {
      const res = await request(app)
        .delete('/api/profile/image')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.profileImage).toBeNull();
    });
  });
});
