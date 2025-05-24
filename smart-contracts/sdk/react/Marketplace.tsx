import React, { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TransferClient, TransferListing } from '../sdk/transfer-client';

/**
 * Props for the Marketplace component
 */
interface MarketplaceProps {
  eventId?: string;
  mode?: 'buy' | 'sell' | 'both';
  programId?: string;
  onTransferComplete?: (result: any) => void;
}

/**
 * Marketplace component for buying and selling tickets
 */
const Marketplace: React.FC<MarketplaceProps> = ({
  eventId,
  mode = 'both',
  programId,
  onTransferComplete,
}) => {
  // State
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>(mode === 'sell' ? 'sell' : 'buy');
  const [listings, setListings] = useState<TransferListing[]>([]);
  const [myListings, setMyListings] = useState<TransferListing[]>([]);
  const [myTickets, setMyTickets] = useState<any[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);
  const [price, setPrice] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Hooks
  const { connection } = useConnection();
  const wallet = useWallet();
  
  // Create transfer client
  const transferClient = new TransferClient(
    connection,
    wallet,
    programId ? new PublicKey(programId) : undefined
  );
  
  // Fetch listings
  const fetchListings = useCallback(async () => {
    if (!eventId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const eventPublicKey = new PublicKey(eventId);
      const listings = await transferClient.getEventListings(eventPublicKey);
      
      // Filter out inactive listings
      const activeListings = listings.filter(listing => listing.isActive);
      
      setListings(activeListings);
    } catch (err) {
      console.error('Error fetching listings:', err);
      setError('Failed to load listings');
    } finally {
      setLoading(false);
    }
  }, [eventId, transferClient]);
  
  // Fetch my listings
  const fetchMyListings = useCallback(async () => {
    if (!wallet.publicKey) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const myListings = await transferClient.getSellerListings(wallet.publicKey);
      
      // Filter by event if provided
      const filteredListings = eventId
        ? myListings.filter(listing => listing.eventId === eventId)
        : myListings;
      
      // Filter out inactive listings
      const activeListings = filteredListings.filter(listing => listing.isActive);
      
      setMyListings(activeListings);
    } catch (err) {
      console.error('Error fetching my listings:', err);
      setError('Failed to load your listings');
    } finally {
      setLoading(false);
    }
  }, [wallet.publicKey, eventId, transferClient]);
  
  // Fetch my tickets
  const fetchMyTickets = useCallback(async () => {
    if (!wallet.publicKey) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // This would be replaced with your actual API call
      // to get tickets owned by the wallet
      const response = await fetch(`/api/tickets/owner/${wallet.publicKey.toString()}`);
      const data = await response.json();
      
      // Filter by event if provided
      const filteredTickets = eventId
        ? data.tickets.filter((ticket: any) => ticket.eventId === eventId)
        : data.tickets;
      
      setMyTickets(filteredTickets);
    } catch (err) {
      console.error('Error fetching my tickets:', err);
      setError('Failed to load your tickets');
    } finally {
      setLoading(false);
    }
  }, [wallet.publicKey, eventId]);
  
  // Initial data fetch
  useEffect(() => {
    if ((mode === 'buy' || mode === 'both') && eventId) {
      fetchListings();
    }
    
    if ((mode === 'sell' || mode === 'both') && wallet.publicKey) {
      fetchMyTickets();
      fetchMyListings();
    }
  }, [mode, eventId, wallet.publicKey, fetchListings, fetchMyTickets, fetchMyListings]);
  
  // Create listing
  const createListing = async () => {
    if (!selectedTicket || price <= 0) {
      setError('Please select a ticket and set a valid price');
      return;
    }
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const ticketMint = new PublicKey(selectedTicket);
      
      // Create listing
      const listingAddress = await transferClient.createListing({
        ticketMint,
        price: price * LAMPORTS_PER_SOL, // Convert SOL to lamports
      });
      
      setSuccess(`Listing created successfully!`);
      
      // Refresh listings
      fetchMyListings();
      
      setSelectedTicket(null);
      setPrice(0);
    } catch (err) {
      console.error('Error creating listing:', err);
      setError('Failed to create listing');
    } finally {
      setLoading(false);
    }
  };
  
  // Cancel listing
  const cancelListing = async (listingData: TransferListing) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Cancel listing
      await transferClient.cancelListing({
        ticketMint: listingData.ticketMint,
      });
      
      setSuccess('Listing cancelled successfully!');
      
      // Refresh listings
      fetchMyListings();
    } catch (err) {
      console.error('Error cancelling listing:', err);
      setError('Failed to cancel listing');
    } finally {
      setLoading(false);
    }
  };
  
  // Buy ticket
  const buyTicket = async (listingData: TransferListing) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      // Buy ticket
      const result = await transferClient.acceptListing({
        listingAddress: listingData.listingAddress,
        ticketMint: listingData.ticketMint,
        seller: listingData.owner,
      });
      
      if (result.success) {
        setSuccess('Ticket purchased successfully!');
        
        // Refresh listings
        fetchListings();
        
        // Notify parent
        if (onTransferComplete) {
          onTransferComplete(result);
        }
      } else {
        setError(result.error || 'Failed to purchase ticket');
      }
    } catch (err) {
      console.error('Error buying ticket:', err);
      setError('Failed to purchase ticket');
    } finally {
      setLoading(false);
    }
  };
  
  // Format price in SOL
  const formatPrice = (lamports: number) => {
    return (lamports / LAMPORTS_PER_SOL).toFixed(2);
  };
  
  return (
    <div className="marketplace">
      <h2>Ticket Marketplace</h2>
      
      {/* Mode tabs */}
      {mode === 'both' && (
        <div className="tabs">
          <button
            className={activeTab === 'buy' ? 'active' : ''}
            onClick={() => setActiveTab('buy')}
          >
            Buy Tickets
          </button>
          <button
            className={activeTab === 'sell' ? 'active' : ''}
            onClick={() => setActiveTab('sell')}
          >
            Sell Tickets
          </button>
        </div>
      )}
      
      {/* Error and success messages */}
      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      
      {success && (
        <div className="success-message">
          <p>{success}</p>
          <button onClick={() => setSuccess(null)}>Dismiss</button>
        </div>
      )}
      
      {/* Buy tab */}
      {(activeTab === 'buy' || mode === 'buy') && (
        <div className="buy-section">
          <h3>Available Tickets</h3>
          
          {loading ? (
            <p>Loading listings...</p>
          ) : listings.length === 0 ? (
            <p>No tickets available for purchase.</p>
          ) : (
            <div className="listings-grid">
              {listings.map((listing, index) => (
                <div key={index} className="listing-card">
                  <h4>{listing.eventName || 'Ticket'}</h4>
                  <p>Type: {listing.ticketType || 'Unknown'}</p>
                  <p>Price: {formatPrice(listing.price)} SOL</p>
                  <p>Seller: {listing.owner.toString().slice(0, 4)}...{listing.owner.toString().slice(-4)}</p>
                  <button
                    onClick={() => buyTicket(listing)}
                    disabled={loading}
                  >
                    {loading ? 'Processing...' : 'Buy Ticket'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {/* Sell tab */}
      {(activeTab === 'sell' || mode === 'sell') && (
        <div className="sell-section">
          <div className="create-listing">
            <h3>Create New Listing</h3>
            
            {!wallet.connected ? (
              <p>Please connect your wallet to list tickets for sale.</p>
            ) : myTickets.length === 0 ? (
              <p>You don't have any tickets to sell.</p>
            ) : (
              <>
                <div className="form-group">
                  <label>Select Ticket</label>
                  <select
                    value={selectedTicket || ''}
                    onChange={e => setSelectedTicket(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">-- Select a ticket --</option>
                    {myTickets.map((ticket, index) => (
                      <option key={index} value={ticket.mint}>
                        {ticket.eventName} - {ticket.ticketType}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Price (SOL)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={price}
                    onChange={e => setPrice(parseFloat(e.target.value))}
                    disabled={loading}
                  />
                </div>
                
                <button
                  onClick={createListing}
                  disabled={loading || !selectedTicket || price <= 0}
                >
                  {loading ? 'Creating...' : 'Create Listing'}
                </button>
              </>
            )}
          </div>
          
          <div className="my-listings">
            <h3>My Active Listings</h3>
            
            {loading ? (
              <p>Loading your listings...</p>
            ) : !wallet.connected ? (
              <p>Please connect your wallet to view your listings.</p>
            ) : myListings.length === 0 ? (
              <p>You don't have any active listings.</p>
            ) : (
              <div className="listings-grid">
                {myListings.map((listing, index) => (
                  <div key={index} className="listing-card">
                    <h4>{listing.eventName || 'Ticket'}</h4>
                    <p>Type: {listing.ticketType || 'Unknown'}</p>
                    <p>Price: {formatPrice(listing.price)} SOL</p>
                    <p>Created: {listing.createdAt.toLocaleDateString()}</p>
                    <button
                      onClick={() => cancelListing(listing)}
                      disabled={loading}
                    >
                      {loading ? 'Processing...' : 'Cancel Listing'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Marketplace;
