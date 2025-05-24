// utils/jwtUtils.js - Functions for generating JWT tokens

const jwt = require('jsonwebtoken');

// Generate a token that expires in 30 days
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

module.exports = { generateToken };
