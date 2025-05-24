/**
 * TicketToken Verification Utilities
 *
 * This module provides functions for off-chain verification of ticket ownership
 * and validation, which can be used by front-end applications.
 */

import { PublicKey, Connection } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { BorshCoder, EventParser } from '@project-serum/anchor';
import { IDL } from '../target/types/ticket_minter';

/**
 * Type definition for a challenge verification result
 */
interface VerificationResult {
  isValid: boolean;
  reason?: string;
  ticket?: any;
  event?: any;
  owner?: string;
  tokenAccount?: string;
}

/**
 * Type definition for verification options
 */
interface VerificationOptions {
  requireFreshSignature?: boolean;
  maxSignatureAge?: number; // in seconds
  allowUsedTickets?: boolean;
  allowExpiredEvents?: boolean;
}

/**
 * Verifies a ticket signature against a verification challenge
 * 
 * @param connection - Solana connection
 * @param challengeAccount - Public key of the verification challenge account
 * @param signature - Signature provided by the ticket owner
 * @param ownerPublicKey - Public key of the claimed ticket owner
 * @param options - Verification options
 * @returns Result of the verification
 */
export async function verifyTicketSignature(
  connection: Connection,
  challengeAccount: PublicKey,
  signature: string,
  ownerPublicKey: PublicKey,
  options: VerificationOptions = {}
): Promise<VerificationResult> {
  try {
    // Set default options
    const defaultOptions: VerificationOptions = {
      requireFreshSignature: true,
      maxSignatureAge: 300, // 5 minutes
      allowUsedTickets: false,
      allowExpiredEvents: false,
    };
    
    const verifyOptions = { ...defaultOptions, ...options };
    
    // Fetch the challenge account
    const challengeAccountInfo = await connection.getAccountInfo(challengeAccount);
    if (!challengeAccountInfo) {
      return {
        isValid: false,
        reason: 'Challenge account not found',
      };
    }
    
    // Deserialize the challenge account using Borsh
    const coder = new BorshCoder(IDL);
    const challengeData = coder.accounts.decode(
      'verificationChallenge',
      challengeAccountInfo.data
    );
    
    // Verify challenge hasn't expired
    const currentTime = Math.floor(Date.now() / 1000);
    if (verifyOptions.requireFreshSignature && 
        (currentTime - challengeData.timestamp.toNumber()) > verifyOptions.maxSignatureAge!) {
      return {
        isValid: false,
        reason: 'Challenge has expired',
      };
    }
    
    // Verify the owner matches
    if (challengeData.owner.toString() !== ownerPublicKey.toString()) {
      return {
        isValid: false,
        reason: 'Owner mismatch',
      };
    }
    
    // Verify signature
    const signatureBuffer = bs58.decode(signature);
    const messageBuffer = Buffer.from(challengeData.challengeData);
    const publicKeyBuffer = ownerPublicKey.toBytes();
    
    const isSignatureValid = nacl.sign.detached.verify(
      messageBuffer,
      signatureBuffer,
      publicKeyBuffer
    );
    
    if (!isSignatureValid) {
      return {
        isValid: false,
        reason: 'Invalid signature',
      };
    }
    
    // Fetch the ticket account
    const ticketAccountInfo = await connection.getAccountInfo(challengeData.ticket);
    if (!ticketAccountInfo) {
      return {
        isValid: false,
        reason: 'Ticket account not found',
      };
    }
    
    // Deserialize the ticket account
    const ticketData = coder.accounts.decode(
      'ticket',
      ticketAccountInfo.data
    );
    
    // Verify ticket status if required
    if (!verifyOptions.allowUsedTickets && ticketData.status.used) {
      return {
        isValid: false,
        reason: 'Ticket has already been used',
      };
    }
    
    if (ticketData.status.revoked) {
      return {
        isValid: false,
        reason: 'Ticket has been revoked',
      };
    }
    
    if (ticketData.status.expired) {
      return {
        isValid: false,
        reason: 'Ticket has expired',
      };
    }
    
    // Fetch the event account
    const eventAccountInfo = await connection.getAccountInfo(challengeData.event);
    if (!eventAccountInfo) {
      return {
        isValid: false,
        reason: 'Event account not found',
      };
    }
    
    // Deserialize the event account
    const eventData = coder.accounts.decode(
      'event',
      eventAccountInfo.data
    );
    
    // Verify event hasn't ended if required
    if (!verifyOptions.allowExpiredEvents && 
        currentTime > eventData.endDate.toNumber()) {
      return {
        isValid: false,
        reason: 'Event has ended',
      };
    }
    
    // All checks passed
    return {
      isValid: true,
      ticket: ticketData,
      event: eventData,
      owner: ownerPublicKey.toString(),
    };
  } catch (error) {
    return {
      isValid: false,
      reason: `Verification error: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Verifies ownership of a ticket by checking the token account
 * 
 * @param connection - Solana connection
 * @param mint - Public key of the ticket mint
 * @param owner - Public key of the claimed owner
 * @returns Result of the verification
 */
export async function verifyTicketOwnership(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  programId: PublicKey
): Promise<VerificationResult> {
  try {
    // Find the ticket PDA
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), mint.toBuffer()],
      programId
    );
    
    // Fetch the ticket account
    const ticketAccountInfo = await connection.getAccountInfo(ticketPda);
    if (!ticketAccountInfo) {
      return {
        isValid: false,
        reason: 'Ticket account not found',
      };
    }
    
    // Deserialize the ticket account
    const coder = new BorshCoder(IDL);
    const ticketData = coder.accounts.decode(
      'ticket',
      ticketAccountInfo.data
    );
    
    // Check if ticket is owned by the claimed owner
    if (ticketData.owner.toString() !== owner.toString()) {
      return {
        isValid: false,
        reason: 'Ticket is not owned by the claimed owner',
      };
    }
    
    // Fetch the event account
    const eventAccountInfo = await connection.getAccountInfo(ticketData.event);
    if (!eventAccountInfo) {
      return {
        isValid: false,
        reason: 'Event account not found',
      };
    }
    
    // Deserialize the event account
    const eventData = coder.accounts.decode(
      'event',
      eventAccountInfo.data
    );
    
    // Check if ticket has valid status
    if (ticketData.status.revoked) {
      return {
        isValid: false,
        reason: 'Ticket has been revoked',
      };
    }
    
    if (ticketData.status.expired) {
      return {
        isValid: false,
        reason: 'Ticket has expired',
      };
    }
    
    // All checks passed
    return {
      isValid: true,
      ticket: ticketData,
      event: eventData,
      owner: owner.toString(),
    };
  } catch (error) {
    return {
      isValid: false,
      reason: `Ownership verification error: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Verifies a ticket by scanning a QR code
 * 
 * @param connection - Solana connection
 * @param qrData - Data from the QR code
 * @param validator - Public key of the validator
 * @param programId - TicketToken program ID
 * @returns Result of the verification
 */
export async function verifyTicketByQR(
  connection: Connection,
  qrData: string,
  validator: PublicKey,
  programId: PublicKey
): Promise<VerificationResult> {
  try {
    // Parse QR data (format: "ticket:{mint}")
    const [prefix, mintString] = qrData.split(':');
    
    if (prefix !== 'ticket' || !mintString) {
      return {
        isValid: false,
        reason: 'Invalid QR code format',
      };
    }
    
    // Parse mint public key
    const mint = new PublicKey(mintString);
    
    // Find the ticket PDA
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), mint.toBuffer()],
      programId
    );
    
    // Fetch the ticket account
    const ticketAccountInfo = await connection.getAccountInfo(ticketPda);
    if (!ticketAccountInfo) {
      return {
        isValid: false,
        reason: 'Ticket account not found',
      };
    }
    
    // Deserialize the ticket account
    const coder = new BorshCoder(IDL);
    const ticketData = coder.accounts.decode(
      'ticket',
      ticketAccountInfo.data
    );
    
    // Check ticket status
    if (ticketData.status.used) {
      return {
        isValid: false,
        reason: 'Ticket has already been used',
      };
    }
    
    if (ticketData.status.revoked) {
      return {
        isValid: false,
        reason: 'Ticket has been revoked',
      };
    }
    
    if (ticketData.status.expired) {
      return {
        isValid: false,
        reason: 'Ticket has expired',
      };
    }
    
    // Fetch the event account
    const eventAccountInfo = await connection.getAccountInfo(ticketData.event);
    if (!eventAccountInfo) {
      return {
        isValid: false,
        reason: 'Event account not found',
      };
    }
    
    // Deserialize the event account
    const eventData = coder.accounts.decode(
      'event',
      eventAccountInfo.data
    );
    
    // Check if the validator is authorized for this event
    const isAuthorized = eventData.validators.some(
      (v) => v.toString() === validator.toString()
    ) || eventData.organizer.toString() === validator.toString();
    
    if (!isAuthorized) {
      return {
        isValid: false,
        reason: 'Validator is not authorized for this event',
      };
    }
    
    // Check if event has started and not ended
    const currentTime = Math.floor(Date.now() / 1000);
    
    if (currentTime < eventData.startDate.toNumber()) {
      return {
        isValid: false,
        reason: 'Event has not started yet',
      };
    }
    
    if (currentTime > eventData.endDate.toNumber()) {
      return {
        isValid: false,
        reason: 'Event has ended',
      };
    }
    
    // All checks passed
    return {
      isValid: true,
      ticket: ticketData,
      event: eventData,
      owner: ticketData.owner.toString(),
    };
  } catch (error) {
    return {
      isValid: false,
      reason: `QR verification error: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Monitors for ticket validation events
 *
 * @param connection - Solana connection
 * @param programId - TicketToken program ID
 * @param callback - Callback function for validation events
 * @returns Subscription ID
 */
export function subscribeToValidationEvents(
  connection: Connection,
  programId: PublicKey,
  callback: (event: any) => void
): number {
  // Create event parser
  const eventParser = new EventParser(programId, new BorshCoder(IDL));
  
  // Subscribe to program logs
  const subscriptionId = connection.onLogs(
    programId,
    (logs) => {
      if (!logs.logs || !logs.logs.length) return;
      
      // Parse events from logs
      const events = eventParser.parseLogs(logs.logs);
      
      // Filter for validation events
      const validationEvents = events.filter(
        (event) => event.name === 'TicketValidatedEvent' || 
                   event.name === 'TicketStatusUpdatedEvent'
      );
      
      // Call callback for each event
      validationEvents.forEach(callback);
    }
  );
  
  return subscriptionId;
}

/**
 * Generates ticket QR code data
 * 
 * @param mint - Public key of the ticket mint
 * @returns QR code data string
 */
export function generateTicketQRData(mint: PublicKey): string {
  return `ticket:${mint.toString()}`;
}
