// tests/user.test.js - Test suite for user endpoints

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');

// Test database setup
const MONGODB_URI = process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/tickettoken_test';

describe('User Endpoints', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI);
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  describe('POST /api/users/register', () => {
    it('should register a new user with email', async () => {
      const userData = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'TestPass123!',
        displayName: 'Test User'
      };

      const res = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(userData.email);
      expect(res.body.data.username).toBe(userData.username);
      expect(res.body.token).toBeDefined();
    });

    it('should register a new user with wallet', async () => {
      const userData = {
        walletAddress: '11111111111111111111111111111112',
        displayName: 'Wallet User'
      };

      const res = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.walletAddresses).toHaveLength(1);
      expect(res.body.data.walletAddresses[0].address).toBe(userData.walletAddress);
      expect(res.body.token).toBeDefined();
    });

    it('should return error for invalid email', async () => {
      const userData = {
        email: 'invalid-email',
        password: 'TestPass123!'
      };

      const res = await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.email).toBeDefined();
    });

    it('should return error for duplicate email', async () => {
      const userData = {
        email: 'test@example.com',
        password: 'TestPass123!',
        username: 'testuser'
      };

      // Create first user
      await request(app)
        .post('/api/users/register')
        .send(userData)
        .expect(201);

      // Try to create duplicate
      const res = await request(app)
        .post('/api/users/register')
        .send({
          email: 'test@example.com',
          password: 'AnotherPass123!',
          username: 'anotheruser'
        })
        .expect(409);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.email).toBeDefined();
    });
  });

  describe('POST /api/users/login', () => {
    beforeEach(async () => {
      // Create a test user
      const userData = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'TestPass123!',
        displayName: 'Test User'
      };

      await request(app)
        .post('/api/users/register')
        .send(userData);
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          email: 'test@example.com',
          password: 'TestPass123!'
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('test@example.com');
      expect(res.body.token).toBeDefined();
    });

    it('should return error for invalid credentials', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword'
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.password).toBeDefined();
    });

    it('should return error for non-existent user', async () => {
      const res = await request(app)
        .post('/api/users/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'TestPass123!'
        })
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.email).toBeDefined();
    });
  });

  describe('POST /api/users/wallet-auth', () => {
    it('should authenticate with valid wallet address', async () => {
      const res = await request(app)
        .post('/api/users/wallet-auth')
        .send({
          walletAddress: '11111111111111111111111111111112',
          displayName: 'Wallet User'
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.walletAddresses).toHaveLength(1);
      expect(res.body.token).toBeDefined();
    });

    it('should return error for invalid wallet address', async () => {
      const res = await request(app)
        .post('/api/users/wallet-auth')
        .send({
          walletAddress: 'invalid-wallet-address'
        })
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(res.body.errors.walletAddress).toBeDefined();
    });
  });

  describe('GET /api/users/profile', () => {
    let authToken;

    beforeEach(async () => {
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
    });

    it('should get user profile with valid token', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('test@example.com');
      expect(res.body.data.username).toBe('testuser');
    });

    it('should return error without authentication', async () => {
      const res = await request(app)
        .get('/api/users/profile')
        .expect(401);

      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Not authorized, no token');
    });
  });

  describe('POST /api/users/check-availability', () => {
    beforeEach(async () => {
      // Create a test user
      const userData = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'TestPass123!'
      };

      await request(app)
        .post('/api/users/register')
        .send(userData);
    });

    it('should check username availability', async () => {
      const res = await request(app)
        .post('/api/users/check-availability')
        .send({ username: 'newuser' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.username.available).toBe(true);
    });

    it('should check email availability', async () => {
      const res = await request(app)
        .post('/api/users/check-availability')
        .send({ email: 'new@example.com' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email.available).toBe(true);
    });

    it('should return unavailable for existing username', async () => {
      const res = await request(app)
        .post('/api/users/check-availability')
        .send({ username: 'testuser' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.username.available).toBe(false);
    });

    it('should return unavailable for existing email', async () => {
      const res = await request(app)
        .post('/api/users/check-availability')
        .send({ email: 'test@example.com' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.email.available).toBe(false);
    });
  });
});
