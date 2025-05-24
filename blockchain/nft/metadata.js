/**
 * TicketToken NFT metadata standard
 * 
 * This module defines the standard structure for NFT ticket metadata
 * and provides utilities for creating and validating metadata.
 */

// Import dependencies
const { PublicKey } = require('@solana/web3.js');

/**
 * Standard ticket attributes
 * 
 * These are the standard attributes that can be included in ticket NFTs.
 * Each attribute has a name, type, and description.
 */
const TICKET_ATTRIBUTES = {
  // Event details
  eventName: { type: 'string', required: true, description: 'Name of the event' },
  eventDate: { type: 'date', required: true, description: 'Date and time of the event (ISO format)' },
  eventId: { type: 'string', required: true, description: 'Unique identifier for the event' },
  
  // Venue information
  venue: { type: 'string', required: true, description: 'Name of the venue' },
  venueAddress: { type: 'string', required: false, description: 'Address of the venue' },
  
  // Ticket details
  ticketType: { type: 'string', required: true, description: 'Type of ticket (e.g., VIP, General Admission)' },
  ticketClass: { type: 'string', required: false, description: 'Class or tier of ticket' },
  section: { type: 'string', required: false, description: 'Seating section' },
  row: { type: 'string', required: false, description: 'Seating row' },
  seat: { type: 'string', required: false, description: 'Seat number' },
  serialNumber: { type: 'number', required: true, description: 'Serial number of the ticket' },
  
  // Status information
  status: { type: 'string', required: true, description: 'Ticket status (Valid, Used, Revoked, etc.)' },
  isTransferable: { type: 'boolean', required: true, description: 'Whether the ticket can be transferred' },
  
  // Additional details
  organizer: { type: 'string', required: true, description: 'Name of the event organizer' },
  category: { type: 'string', required: false, description: 'Event category (Concert, Sports, etc.)' },
  
  // Custom attributes can be added by event organizers
  custom: { type: 'object', required: false, description: 'Custom attributes defined by the event organizer' }
};

/**
 * Creates a metadata object for an NFT ticket
 * 
 * @param {Object} ticketData - Ticket information
 * @returns {Object} Formatted metadata object
 */
function createTicketMetadata(ticketData) {
  // Validate required fields
  const missingFields = [];
  for (const [key, config] of Object.entries(TICKET_ATTRIBUTES)) {
    if (config.required && !ticketData[key]) {
      missingFields.push(key);
    }
  }
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required ticket fields: ${missingFields.join(', ')}`);
  }

  // Format metadata according to the Metaplex NFT standard
  const attributes = [];
  
  // Add standard attributes
  for (const [key, value] of Object.entries(ticketData)) {
    if (key in TICKET_ATTRIBUTES && value !== undefined) {
      attributes.push({
        trait_type: key,
        value: value.toString()
      });
    }
  }
  
  // Add custom attributes if provided
  if (ticketData.custom && typeof ticketData.custom === 'object') {
    for (const [key, value] of Object.entries(ticketData.custom)) {
      attributes.push({
        trait_type: key,
        value: value.toString()
      });
    }
  }
  
  // Create metadata object
  const metadata = {
    name: `${ticketData.eventName} - ${ticketData.ticketType}`,
    symbol: 'TKTTKN',
    description: `Official ticket for ${ticketData.eventName} at ${ticketData.venue} on ${formatDate(ticketData.eventDate)}`,
    seller_fee_basis_points: 500, // 5% royalty for secondary sales
    image: ticketData.imageUrl || '',
    animation_url: ticketData.animationUrl || '',
    external_url: ticketData.externalUrl || `https://tickettoken.app/event/${ticketData.eventId}`,
    attributes,
    properties: {
      files: [
        {
          uri: ticketData.imageUrl || '',
          type: 'image/png'
        }
      ],
      category: 'ticket',
      creators: formatCreators(ticketData.creators)
    }
  };
  
  return metadata;
}

/**
 * Formats the date for display
 * 
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  if (!date) return '';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toISOString();
}

/**
 * Formats creators array for metadata
 * 
 * @param {Array} creators - Array of creator objects
 * @returns {Array} Formatted creators array
 */
function formatCreators(creators = []) {
  if (!creators || !Array.isArray(creators)) {
    return [{
      address: '11111111111111111111111111111111', // Default placeholder address
      share: 100
    }];
  }
  
  return creators.map(creator => ({
    address: creator.address.toString(),
    share: creator.share || 100,
    verified: creator.verified || false
  }));
}

/**
 * Validates ticket metadata against the standard
 * 
 * @param {Object} metadata - Metadata to validate
 * @returns {Object} Validation result
 */
function validateTicketMetadata(metadata) {
  const errors = [];
  const warnings = [];
  
  // Check required top-level fields
  const requiredFields = ['name', 'symbol', 'description', 'image', 'attributes'];
  for (const field of requiredFields) {
    if (!metadata[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }
  
  // Validate attributes
  if (metadata.attributes && Array.isArray(metadata.attributes)) {
    // Extract attribute trait types
    const attributeTraitTypes = metadata.attributes.map(attr => attr.trait_type);
    
    // Check required attributes
    for (const [key, config] of Object.entries(TICKET_ATTRIBUTES)) {
      if (config.required && !attributeTraitTypes.includes(key)) {
        errors.push(`Missing required attribute: ${key}`);
      }
    }
  } else {
    errors.push('Missing or invalid attributes array');
  }
  
  // Validate creators
  if (metadata.properties && metadata.properties.creators) {
    const creators = metadata.properties.creators;
    
    if (!Array.isArray(creators)) {
      errors.push('Creators must be an array');
    } else {
      // Validate each creator
      const sharesSum = creators.reduce((sum, creator) => sum + (creator.share || 0), 0);
      
      if (sharesSum !== 100) {
        errors.push(`Creator shares must sum to 100, got ${sharesSum}`);
      }
      
      // Validate creator addresses
      for (const creator of creators) {
        if (!creator.address) {
          errors.push('Creator missing address');
        } else {
          try {
            new PublicKey(creator.address);
          } catch (error) {
            errors.push(`Invalid creator address: ${creator.address}`);
          }
        }
      }
    }
  } else {
    warnings.push('Missing creators in properties');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Generates an example ticket metadata object
 * 
 * @returns {Object} Example ticket metadata
 */
function getExampleTicketMetadata() {
  const creator = {
    address: 'AKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeJ', // Example address
    share: 100,
    verified: true
  };
  
  const ticketData = {
    eventName: 'Summer Music Festival',
    eventDate: '2025-07-15T19:00:00Z',
    eventId: 'evt_123456789',
    venue: 'Central Park Amphitheater',
    venueAddress: '123 Park Ave, New York, NY',
    ticketType: 'VIP',
    ticketClass: 'Platinum',
    section: 'A',
    row: '1',
    seat: '5',
    serialNumber: 42,
    status: 'Valid',
    isTransferable: true,
    organizer: 'Epic Events Inc.',
    category: 'Concert',
    imageUrl: 'https://tickettoken.app/assets/tickets/summer-fest-vip.png',
    animationUrl: 'https://tickettoken.app/assets/tickets/summer-fest-vip.mp4',
    externalUrl: 'https://tickettoken.app/event/evt_123456789',
    creators: [creator],
    custom: {
      backstageAccess: 'Yes',
      merchandiseIncluded: 'T-shirt, Poster',
      specialInstructions: 'Arrive 30 minutes early for VIP entry'
    }
  };
  
  return createTicketMetadata(ticketData);
}

// Export functions and constants
module.exports = {
  TICKET_ATTRIBUTES,
  createTicketMetadata,
  validateTicketMetadata,
  getExampleTicketMetadata
};
