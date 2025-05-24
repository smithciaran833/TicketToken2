import React, { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  TransactionInstruction 
} from '@solana/web3.js';
import { 
  verifyTicketByQR, 
  verifyTicketOwnership, 
  verifyTicketSignature 
} from '../sdk/verification-utils';
import QrReader from 'react-qr-reader';
import axios from 'axios';

// Program ID for TicketToken
const PROGRAM_ID = new PublicKey('Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS');

/**
 * Props for the TicketVerifier component
 */
interface TicketVerifierProps {
  mode?: 'scan' | 'manual' | 'ownership';
  onVerified?: (result: any) => void;
  onError?: (error: string) => void;
  isValidator?: boolean;
  allowUsedTickets?: boolean;
  autoMarkAsUsed?: boolean;
  eventId?: string;
}

/**
 * TicketVerifier component for verifying tickets
 */
const TicketVerifier: React.FC<TicketVerifierProps> = ({
  mode = 'scan',
  onVerified,
  onError,
  isValidator = false,
  allowUsedTickets = false,
  autoMarkAsUsed = false,
  eventId,
}) => {
  // State
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [ticketMint, setTicketMint] = useState<string>('');
  const [ticketOwner, setTicketOwner] = useState<string>('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  
  // Hooks
  const { connection } = useConnection();
  const wallet = useWallet();
  
  /**
   * Handles scanning QR codes
   */
  const handleScan = useCallback(async (data: string | null) => {
    if (data && !loading) {
      setLoading(true);
      setError('');
      
      try {
        // Verify ticket from QR
        if (!wallet.publicKey) {
          throw new Error('Wallet not connected');
        }
        
        const verificationResult = await verifyTicketByQR(
          connection,
          data,
          wallet.publicKey,
          PROGRAM_ID
        );
        
        if (verificationResult.isValid) {
          setResult(verificationResult);
          
          // Mark ticket as used if auto-mark is enabled and we're a validator
          if (autoMarkAsUsed && isValidator && wallet.signTransaction) {
            await markTicketAsUsed(
              verificationResult.ticket.mint,
              wallet.publicKey
            );
          }
          
          if (onVerified) {
            onVerified(verificationResult);
          }
        } else {
          throw new Error(verificationResult.reason || 'Verification failed');
        }
      } catch (err) {
        setError(err.message);
        if (onError) {
          onError(err.message);
        }
      } finally {
        setLoading(false);
        setIsScanning(false);
      }
    }
  }, [connection, wallet, loading, onVerified, onError, isValidator, autoMarkAsUsed]);
  
  /**
   * Handles QR scan errors
   */
  const handleScanError = useCallback((err: any) => {
    setError(`QR scan error: ${err.message || 'Unknown error'}`);
    if (onError) {
      onError(`QR scan error: ${err.message || 'Unknown error'}`);
    }
  }, [onError]);
  
  /**
   * Verifies a ticket by mint address
   */
  const verifyTicketByMint = useCallback(async () => {
    if (!ticketMint) {
      setError('Please enter a ticket mint address');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // Validate mint address
      const mintPubkey = new PublicKey(ticketMint);
      
      // If ticket owner is provided, verify ownership
      if (ticketOwner) {
        try {
          const ownerPubkey = new PublicKey(ticketOwner);
          
          const verificationResult = await verifyTicketOwnership(
            connection,
            mintPubkey,
            ownerPubkey,
            PROGRAM_ID
          );
          
          if (verificationResult.isValid) {
            setResult(verificationResult);
            
            if (onVerified) {
              onVerified(verificationResult);
            }
          } else {
            throw new Error(verificationResult.reason || 'Verification failed');
          }
        } catch (err) {
          throw new Error(`Invalid owner address: ${err.message}`);
        }
      } else {
        // Just check if the ticket exists and is valid
        const [ticketPda] = await PublicKey.findProgramAddress(
          [Buffer.from('ticket'), mintPubkey.toBuffer()],
          PROGRAM_ID
        );
        
        const ticketAccountInfo = await connection.getAccountInfo(ticketPda);
        if (!ticketAccountInfo) {
          throw new Error('Ticket not found');
        }
        
        // This is a simplified version - in a real app, you would deserialize
        // the account data and verify its validity
        setResult({
          isValid: true,
          ticket: { mint: mintPubkey.toString() }
        });
        
        if (onVerified) {
          onVerified({ isValid: true, ticket: { mint: mintPubkey.toString() } });
        }
      }
    } catch (err) {
      setError(err.message);
      if (onError) {
        onError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [connection, ticketMint, ticketOwner, onVerified, onError]);
  
  /**
   * Marks a ticket as used
   */
  const markTicketAsUsed = async (mint: string, validator: PublicKey) => {
    if (!wallet.signTransaction) {
      throw new Error('Wallet does not support signing transactions');
    }
    
    // First, find the ticket PDA
    const mintPubkey = new PublicKey(mint);
    const [ticketPda] = await PublicKey.findProgramAddress(
      [Buffer.from('ticket'), mintPubkey.toBuffer()],
      PROGRAM_ID
    );
    
    // Find the event PDA for this ticket
    // This is a simplified version - in a real app, you would look up the
    // event PDA from the ticket account data
    const eventPubkey = eventId ? new PublicKey(eventId) : null;
    if (!eventPubkey) {
      throw new Error('Event ID required to mark ticket as used');
    }
    
    // Create the instruction to mark the ticket as used
    const markUsedIx = new TransactionInstruction({
      keys: [
        { pubkey: eventPubkey, isSigner: false, isWritable: false },
        { pubkey: ticketPda, isSigner: false, isWritable: true },
        { pubkey: validator, isSigner: true, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: Buffer.from([1]), // Simplified - in reality, you would use proper serialization
    });
    
    // Create and send the transaction
    const transaction = new Transaction().add(markUsedIx);
    transaction.feePayer = wallet.publicKey;
    
    // Get the recent blockhash
    const { blockhash } = await connection.getRecentBlockhash();
    transaction.recentBlockhash = blockhash;
    
    // Sign the transaction
    const signedTransaction = await wallet.signTransaction(transaction);
    
    // Send the transaction
    const signature = await connection.sendRawTransaction(signedTransaction.serialize());
    
    // Wait for confirmation
    await connection.confirmTransaction(signature);
    
    console.log(`Ticket ${mint} marked as used. Signature: ${signature}`);
    return signature;
  };
  
  /**
   * Verifies ownership of connected wallet's tickets
   */
  const verifyOwnedTickets = useCallback(async () => {
    if (!wallet.publicKey) {
      setError('Wallet not connected');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      // This would be a server endpoint that uses the program to look up tickets
      const response = await axios.get(`/api/tickets/owner/${wallet.publicKey.toString()}`);
      
      if (response.data && response.data.tickets && response.data.tickets.length > 0) {
        setResult({
          isValid: true,
          tickets: response.data.tickets,
          count: response.data.tickets.length
        });
        
        if (onVerified) {
          onVerified({
            isValid: true,
            tickets: response.data.tickets,
            count: response.data.tickets.length
          });
        }
      } else {
        throw new Error('No tickets found for this wallet');
      }
    } catch (err) {
      setError(err.message);
      if (onError) {
        onError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [connection, wallet, onVerified, onError]);
  
  // Reset data when mode changes
  useEffect(() => {
    setTicketMint('');
    setTicketOwner('');
    setResult(null);
    setError('');
  }, [mode]);
  
  return (
    <div className="ticket-verifier">
      <h2>Ticket Verification</h2>
      
      {/* Mode Selection */}
      <div className="verification-mode">
        <button
          className={mode === 'scan' ? 'active' : ''}
          onClick={() => mode !== 'scan' && setIsScanning(false)}
        >
          Scan QR
        </button>
        <button
          className={mode === 'manual' ? 'active' : ''}
          onClick={() => mode !== 'manual' && setIsScanning(false)}
        >
          Enter Details
        </button>
        {wallet.connected && (
          <button
            className={mode === 'ownership' ? 'active' : ''}
            onClick={() => mode !== 'ownership' && setIsScanning(false)}
          >
            My Tickets
          </button>
        )}
      </div>
      
      {/* QR Scanner */}
      {mode === 'scan' && (
        <div className="qr-scanner-container">
          {isScanning ? (
            <div className="scanner">
              <QrReader
                delay={300}
                onError={handleScanError}
                onScan={handleScan}
                style={{ width: '100%' }}
              />
              <button onClick={() => setIsScanning(false)}>Cancel</button>
            </div>
          ) : (
            <button 
              className="scan-button" 
              onClick={() => setIsScanning(true)}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Start Scanning'}
            </button>
          )}
        </div>
      )}
      
      {/* Manual Verification */}
      {mode === 'manual' && (
        <div className="manual-verification">
          <div className="input-group">
            <label>Ticket Mint Address</label>
            <input
              type="text"
              value={ticketMint}
              onChange={(e) => setTicketMint(e.target.value)}
              placeholder="Enter ticket mint address"
              disabled={loading}
            />
          </div>
          
          <div className="input-group">
            <label>Ticket Owner (Optional)</label>
            <input
              type="text"
              value={ticketOwner}
              onChange={(e) => setTicketOwner(e.target.value)}
              placeholder="Enter ticket owner address"
              disabled={loading}
            />
          </div>
          
          <button 
            onClick={verifyTicketByMint}
            disabled={loading || !ticketMint}
          >
            {loading ? 'Verifying...' : 'Verify Ticket'}
          </button>
        </div>
      )}
      
      {/* Ownership Verification */}
      {mode === 'ownership' && (
        <div className="ownership-verification">
          {!wallet.connected ? (
            <p>Please connect your wallet to verify your tickets</p>
          ) : (
            <button 
              onClick={verifyOwnedTickets}
              disabled={loading}
            >
              {loading ? 'Checking...' : 'Check My Tickets'}
            </button>
          )}
        </div>
      )}
      
      {/* Error Message */}
      {error && (
        <div className="error-message">
          <p>{error}</p>
        </div>
      )}
      
      {/* Verification Result */}
      {result && result.isValid && (
        <div className="verification-result success">
          <h3>Verification Successful</h3>
          
          {result.ticket && (
            <div className="ticket-info">
              <p><strong>Ticket:</strong> {result.ticket.mint}</p>
              {result.ticket.serialNumber && (
                <p><strong>Serial Number:</strong> {result.ticket.serialNumber}</p>
              )}
              {result.owner && (
                <p><strong>Owner:</strong> {result.owner}</p>
              )}
              {result.event && (
                <div className="event-info">
                  <p><strong>Event:</strong> {result.event.name}</p>
                  <p><strong>Venue:</strong> {result.event.venue}</p>
                  <p><strong>Date:</strong> {new Date(result.event.startDate * 1000).toLocaleString()}</p>
                </div>
              )}
            </div>
          )}
          
          {result.tickets && (
            <div className="tickets-info">
              <p><strong>Owned Tickets:</strong> {result.count}</p>
              <ul className="ticket-list">
                {result.tickets.map((ticket: any, index: number) => (
                  <li key={index}>
                    <p><strong>Ticket {index + 1}:</strong> {ticket.mint}</p>
                    <p><strong>Event:</strong> {ticket.eventName}</p>
                    <p><strong>Type:</strong> {ticket.ticketType}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {isValidator && autoMarkAsUsed && result.ticket && (
            <div className="validator-actions">
              <p className="success-message">Ticket automatically marked as used.</p>
            </div>
          )}
          
          {isValidator && !autoMarkAsUsed && result.ticket && (
            <div className="validator-actions">
              <button 
                onClick={() => markTicketAsUsed(result.ticket.mint, wallet.publicKey!)}
                disabled={loading}
              >
                {loading ? 'Processing...' : 'Mark Ticket as Used'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TicketVerifier;
