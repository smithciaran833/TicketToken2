/**
 * TicketToken Verification Middleware
 * 
 * This module provides Express middleware for verifying ticket ownership
 * and validating tickets in API requests.
 */

// Import dependencies
const { Connection, PublicKey } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const express = require('express');
const anchor = require('@project-serum/anchor');
const { BorshCoder } = require('@project-serum/anchor');

// Import IDL for account deserialization
const { IDL } = require('../target/types/ticket_minter');

// Program ID for TicketToken
const PROGRAM_ID = 'Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS';

/**
 * Creates ticket verification middleware
 * 
 * @param {Connection} connection - Solana connection
 * @param {object} options - Configuration options
 * @returns {Function} Express middleware
 */
function createTicketVerificationMiddleware(connection, options = {}) {
  // Default options
  const defaultOptions = {
    requireFreshSignature: true,
    maxSignatureAge: 300, // 5 minutes
    allowUsedTickets: false,
    allowExpiredEvents: false,
    requireValidatorRole: true,
  };
  
  const config = { ...defaultOptions, ...options };
  
  // Create BorshCoder for account deserialization
  const coder = new BorshCoder(IDL);
  
  /**
   * Middleware for verifying ticket ownership
   */
  return async function verifyTicketOwnership(req, res, next) {
    try {
      // Get verification data from request
      const { 
        ticketMint, 
        ownerPublicKey, 
        signature, 
        message,
        challengeAccount 
      } = req.body;
      
      // Validate required fields
      if (!ticketMint) {
        return res.status(400).json({ error: 'Ticket mint is required' });
      }
      
      if (!ownerPublicKey) {
        return res.status(400).json({ error: 'Owner public key is required' });
      }
      
      // Parse public keys
      let mintPubkey, ownerPubkeyObj, challengePubkey;
      
      try {
        mintPubkey = new PublicKey(ticketMint);
        ownerPubkeyObj = new PublicKey(ownerPublicKey);
        
        if (challengeAccount) {
          challengePubkey = new PublicKey(challengeAccount);
        }
      } catch (error) {
        return res.status(400).json({ error: 'Invalid public key format' });
      }
      
      // Find the ticket PDA
      const [ticketPda] = await PublicKey.findProgramAddress(
        [Buffer.from('ticket'), mintPubkey.toBuffer()],
        new PublicKey(PROGRAM_ID)
      );
      
      // Fetch the ticket account
      const ticketAccountInfo = await connection.getAccountInfo(ticketPda);
      
      if (!ticketAccountInfo) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      
      // Deserialize the ticket account
      const ticketData = coder.accounts.decode(
        'ticket',
        ticketAccountInfo.data
      );
      
      // Verify owner matches
      if (ticketData.owner.toString() !== ownerPubkeyObj.toString()) {
        return res.status(403).json({ error: 'Ticket owner mismatch' });
      }
      
      // Verify ticket status if required
      if (!config.allowUsedTickets && ticketData.status.used) {
        return res.status(400).json({ error: 'Ticket has already been used' });
      }
      
      if (ticketData.status.revoked) {
        return res.status(400).json({ error: 'Ticket has been revoked' });
      }
      
      if (ticketData.status.expired) {
        return res.status(400).json({ error: 'Ticket has expired' });
      }
      
      // Fetch the event account
      const eventAccountInfo = await connection.getAccountInfo(ticketData.event);
      
      if (!eventAccountInfo) {
        return res.status(404).json({ error: 'Event not found' });
      }
      
      // Deserialize the event account
      const eventData = coder.accounts.decode(
        'event',
        eventAccountInfo.data
      );
      
      // Check if event has ended
      const currentTime = Math.floor(Date.now() / 1000);
      
      if (!config.allowExpiredEvents && currentTime > eventData.endDate.toNumber()) {
        return res.status(400).json({ error: 'Event has ended' });
      }
      
      // If signature verification is required
      if (signature && message) {
        try {
          // Verify signature
          const signatureBuffer = bs58.decode(signature);
          const messageBuffer = Buffer.from(message);
          const publicKeyBuffer = ownerPubkeyObj.toBuffer();
          
          const isSignatureValid = nacl.sign.detached.verify(
            messageBuffer,
            signatureBuffer,
            publicKeyBuffer
          );
          
          if (!isSignatureValid) {
            return res.status(403).json({ error: 'Invalid signature' });
          }
        } catch (error) {
          return res.status(400).json({ error: `Signature verification error: ${error.message}` });
        }
      } else if (challengeAccount) {
        // If challenge account verification is used
        const challengeAccountInfo = await connection.getAccountInfo(challengePubkey);
        
        if (!challengeAccountInfo) {
          return res.status(404).json({ error: 'Challenge account not found' });
        }
        
        // Deserialize the challenge account
        const challengeData = coder.accounts.decode(
          'verificationChallenge',
          challengeAccountInfo.data
        );
        
        // Verify challenge hasn't expired
        if (config.requireFreshSignature && 
            (currentTime - challengeData.timestamp.toNumber()) > config.maxSignatureAge) {
          return res.status(400).json({ error: 'Challenge has expired' });
        }
        
        // Verify the owner and ticket match
        if (challengeData.owner.toString() !== ownerPubkeyObj.toString()) {
          return res.status(403).json({ error: 'Challenge owner mismatch' });
        }
        
        if (challengeData.ticket.toString() !== ticketPda.toString()) {
          return res.status(403).json({ error: 'Challenge ticket mismatch' });
        }
        
        if (!signature) {
          return res.status(400).json({ error: 'Signature is required for challenge verification' });
        }
        
        // Verify signature
        try {
          const signatureBuffer = bs58.decode(signature);
          const messageBuffer = Buffer.from(challengeData.challengeData);
          const publicKeyBuffer = ownerPubkeyObj.toBuffer();
          
          const isSignatureValid = nacl.sign.detached.verify(
            messageBuffer,
            signatureBuffer,
            publicKeyBuffer
          );
          
          if (!isSignatureValid) {
            return res.status(403).json({ error: 'Invalid challenge signature' });
          }
        } catch (error) {
          return res.status(400).json({ error: `Challenge signature verification error: ${error.message}` });
        }
      }
      
      // Check if the request user is a validator (if required)
      if (config.requireValidatorRole && req.user) {
        const isValidator = eventData.validators.some(
          v => v.toString() === req.user.publicKey
        ) || eventData.organizer.toString() === req.user.publicKey;
        
        if (!isValidator) {
          return res.status(403).json({ error: 'User is not authorized as a validator for this event' });
        }
      }
      
      // All checks passed, attach verified data to request
      req.verifiedTicket = {
        ticket: ticketData,
        event: eventData,
        owner: ownerPubkeyObj.toString(),
        mint: mintPubkey.toString(),
        pda: ticketPda.toString()
      };
      
      // Continue to the next middleware/route handler
      next();
    } catch (error) {
      console.error('Verification error:', error);
      return res.status(500).json({ error: 'Internal server error during verification' });
    }
  };
}

/**
 * Creates middleware for requiring validator role
 * 
 * @param {Connection} connection - Solana connection
 * @returns {Function} Express middleware
 */
function requireValidatorRole(connection) {
  return async function(req, res, next) {
    try {
      // User must be authenticated
      if (!req.user || !req.user.publicKey) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      // Event ID must be provided
      if (!req.params.eventId && !req.body.eventId) {
        return res.status(400).json({ error: 'Event ID is required' });
      }
      
      const eventId = req.params.eventId || req.body.eventId;
      
      try {
        // Parse event public key
        const eventPubkey = new PublicKey(eventId);
        
        // Fetch the event account
        const eventAccountInfo = await connection.getAccountInfo(eventPubkey);
        
        if (!eventAccountInfo) {
          return res.status(404).json({ error: 'Event not found' });
        }
        
        // Deserialize the event account
        const coder = new BorshCoder(IDL);
        const eventData = coder.accounts.decode(
          'event',
          eventAccountInfo.data
        );
        
        // Check if user is a validator or organizer
        const userPubkey = new PublicKey(req.user.publicKey);
        const isValidator = eventData.validators.some(
          v => v.toString() === userPubkey.toString()
        );
        const isOrganizer = eventData.organizer.toString() === userPubkey.toString();
        
        if (!isValidator && !isOrganizer) {
          return res.status(403).json({ error: 'User is not authorized as a validator for this event' });
        }
        
        // Attach event data to request
        req.event = eventData;
        
        // Continue to the next middleware/route handler
        next();
      } catch (error) {
        return res.status(400).json({ error: 'Invalid event ID format' });
      }
    } catch (error) {
      console.error('Validator role check error:', error);
      return res.status(500).json({ error: 'Internal server error checking validator role' });
    }
  };
}

/**
 * Creates an example Express router with verification endpoints
 * 
 * @param {Connection} connection - Solana connection
 * @returns {Router} Express router
 */
function createVerificationRouter(connection) {
  const router = express.Router();
  
  // Middleware for verifying tickets
  const verifyTicket = createTicketVerificationMiddleware(connection);
  
  // Middleware for requiring validator role
  const requireValidator = requireValidatorRole(connection);
  
  // Endpoint for verifying a ticket
  router.post('/verify', verifyTicket, (req, res) => {
    res.json({
      success: true,
      ticket: {
        mint: req.verifiedTicket.mint,
        owner: req.verifiedTicket.owner,
        event: req.verifiedTicket.event.name,
        ticketType: req.verifiedTicket.ticket.ticketType,
        status: getStatusString(req.verifiedTicket.ticket.status)
      }
    });
  });
  
  // Endpoint for marking a ticket as used
  router.post('/mark-used', requireValidator, async (req, res) => {
    try {
      const { ticketMint } = req.body;
      
      if (!ticketMint) {
        return res.status(400).json({ error: 'Ticket mint is required' });
      }
      
      // Implementation would call on-chain program to mark ticket as used
      res.json({ success: true, message: 'Ticket marked as used' });
    } catch (error) {
      console.error('Error marking ticket as used:', error);
      res.status(500).json({ error: 'Failed to mark ticket as used' });
    }
  });
  
  // Endpoint for generating a verification challenge
  router.post('/generate-challenge', requireValidator, async (req, res) => {
    try {
      const { ticketMint, ticketOwner } = req.body;
      
      if (!ticketMint || !ticketOwner) {
        return res.status(400).json({ error: 'Ticket mint and owner are required' });
      }
      
      // Implementation would create an on-chain challenge
      res.json({ 
        success: true, 
        challengeAccount: 'challenge-account-pubkey', 
        message: 'Verification challenge message to sign' 
      });
    } catch (error) {
      console.error('Error generating challenge:', error);
      res.status(500).json({ error: 'Failed to generate challenge' });
    }
  });
  
  return router;
}

/**
 * Helper function to convert status enum to string
 */
function getStatusString(status) {
  if (status.valid) return 'Valid';
  if (status.used) return 'Used';
  if (status.revoked) return 'Revoked';
  if (status.expired) return 'Expired';
  return 'Unknown';
}

// Export middleware and router factory
module.exports = {
  createTicketVerificationMiddleware,
  requireValidatorRole,
  createVerificationRouter
};
