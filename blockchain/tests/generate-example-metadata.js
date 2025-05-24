/**
 * Example metadata generator for TicketToken NFTs
 * 
 * This script generates example NFT metadata files for different
 * ticket types and scenarios.
 */

// Import dependencies
const fs = require('fs');
const path = require('path');
const { createTicketMetadata, validateTicketMetadata } = require('../nft/metadata');

// Output directory for example metadata
const OUTPUT_DIR = path.join(__dirname, '..', 'examples', 'metadata');

/**
 * Creates example metadata files for different ticket types
 */
function generateExampleMetadata() {
  console.log('Generating example NFT metadata files...');
  
  // Create output directory if it doesn't exist
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Generate example metadata for different ticket types
  generateConcertTicket();
  generateSportsTicket();
  generateConferenceTicket();
  generateFestivalTicket();
  generateTheaterTicket();
  
  console.log(`Generated example metadata files in ${OUTPUT_DIR}`);
}

/**
 * Writes metadata to a JSON file
 * 
 * @param {string} filename - Output filename
 * @param {Object} metadata - Metadata object
 */
function writeMetadataFile(filename, metadata) {
  const filePath = path.join(OUTPUT_DIR, filename);
  
  // Validate metadata
  const validation = validateTicketMetadata(metadata);
  if (!validation.isValid) {
    console.error(`Invalid metadata for ${filename}:`, validation.errors);
    return;
  }
  
  // Write file
  fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
  console.log(`Created ${filename}`);
}

/**
 * Generates metadata for a concert ticket
 */
function generateConcertTicket() {
  const creator = {
    address: 'AKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeJ',
    share: 100,
    verified: true
  };
  
  const ticketData = {
    eventName: 'Summer Rock Concert',
    eventDate: '2025-07-15T19:00:00Z',
    eventId: 'evt_rock_concert_2025',
    venue: 'Mega Arena',
    venueAddress: '123 Music Blvd, Los Angeles, CA',
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
    imageUrl: 'https://tickettoken.app/assets/tickets/rock-concert-vip.png',
    animationUrl: 'https://tickettoken.app/assets/tickets/rock-concert-vip.mp4',
    externalUrl: 'https://tickettoken.app/event/evt_rock_concert_2025',
    creators: [creator],
    custom: {
      backstageAccess: 'Yes',
      merchandiseIncluded: 'T-shirt, Poster',
      meetAndGreet: 'Yes'
    }
  };
  
  const metadata = createTicketMetadata(ticketData);
  writeMetadataFile('concert-vip-ticket.json', metadata);
}

/**
 * Generates metadata for a sports ticket
 */
function generateSportsTicket() {
  const creators = [
    {
      address: 'BKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeK',
      share: 70,
      verified: true
    },
    {
      address: 'CKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeL',
      share: 30,
      verified: false
    }
  ];
  
  const ticketData = {
    eventName: 'Championship Finals',
    eventDate: '2025-08-10T15:30:00Z',
    eventId: 'evt_championship_finals_2025',
    venue: 'Sports Stadium',
    venueAddress: '456 Stadium Way, New York, NY',
    ticketType: 'Premium',
    ticketClass: 'Gold',
    section: 'Lower 101',
    row: '15',
    seat: '22',
    serialNumber: 1058,
    status: 'Valid',
    isTransferable: true,
    organizer: 'Major League Sports',
    category: 'Sports',
    imageUrl: 'https://tickettoken.app/assets/tickets/championship-premium.png',
    animationUrl: 'https://tickettoken.app/assets/tickets/championship-premium.mp4',
    externalUrl: 'https://tickettoken.app/event/evt_championship_finals_2025',
    creators: creators,
    custom: {
      includesFood: 'Yes',
      loungeAccess: 'Yes',
      parkingPass: 'VIP Lot A'
    }
  };
  
  const metadata = createTicketMetadata(ticketData);
  writeMetadataFile('sports-premium-ticket.json', metadata);
}

/**
 * Generates metadata for a conference ticket
 */
function generateConferenceTicket() {
  const creator = {
    address: 'DKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeM',
    share: 100,
    verified: true
  };
  
  const ticketData = {
    eventName: 'Blockchain Summit 2025',
    eventDate: '2025-09-20T09:00:00Z',
    eventId: 'evt_blockchain_summit_2025',
    venue: 'Conference Center',
    venueAddress: '789 Tech Ave, San Francisco, CA',
    ticketType: 'All Access',
    ticketClass: 'Business',
    section: 'N/A',
    row: 'N/A',
    seat: 'N/A',
    serialNumber: 305,
    status: 'Valid',
    isTransferable: false,
    organizer: 'Tech Conferences Inc.',
    category: 'Conference',
    imageUrl: 'https://tickettoken.app/assets/tickets/blockchain-summit-all-access.png',
    animationUrl: 'https://tickettoken.app/assets/tickets/blockchain-summit-all-access.mp4',
    externalUrl: 'https://tickettoken.app/event/evt_blockchain_summit_2025',
    creators: [creator],
    custom: {
      workshopAccess: 'All Workshops',
      virtualAccess: '30-day replay access',
      swagBag: 'Yes'
    }
  };
  
  const metadata = createTicketMetadata(ticketData);
  writeMetadataFile('conference-all-access-ticket.json', metadata);
}

/**
 * Generates metadata for a festival ticket
 */
function generateFestivalTicket() {
  const creator = {
    address: 'EKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeN',
    share: 100,
    verified: true
  };
  
  const ticketData = {
    eventName: 'Art & Music Festival',
    eventDate: '2025-06-05T12:00:00Z',
    eventId: 'evt_art_music_festival_2025',
    venue: 'Riverside Park',
    venueAddress: '101 River Rd, Austin, TX',
    ticketType: 'Weekend Pass',
    ticketClass: 'Standard',
    section: 'General Admission',
    row: 'N/A',
    seat: 'N/A',
    serialNumber: 2459,
    status: 'Valid',
    isTransferable: true,
    organizer: 'Festival Productions',
    category: 'Festival',
    imageUrl: 'https://tickettoken.app/assets/tickets/art-music-festival-weekend.png',
    animationUrl: 'https://tickettoken.app/assets/tickets/art-music-festival-weekend.mp4',
    externalUrl: 'https://tickettoken.app/event/evt_art_music_festival_2025',
    creators: [creator],
    custom: {
      camping: 'No',
      reentry: 'Unlimited',
      ageRestriction: '18+'
    }
  };
  
  const metadata = createTicketMetadata(ticketData);
  writeMetadataFile('festival-weekend-ticket.json', metadata);
}

/**
 * Generates metadata for a theater ticket
 */
function generateTheaterTicket() {
  const creators = [
    {
      address: 'FKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeO',
      share: 50,
      verified: true
    },
    {
      address: 'GKnL4NNf2B3j1EcRoyWGSAkY48eQkgXgEL4x3MQ5iUeP',
      share: 50,
      verified: true
    }
  ];
  
  const ticketData = {
    eventName: 'Hamilton: The Musical',
    eventDate: '2025-11-12T19:30:00Z',
    eventId: 'evt_hamilton_nov12_2025',
    venue: 'Broadway Theater',
    venueAddress: '222 Broadway, New York, NY',
    ticketType: 'Orchestra',
    ticketClass: 'Center',
    section: 'Orchestra',
    row: 'F',
    seat: '107',
    serialNumber: 732,
    status: 'Valid',
    isTransferable: true,
    organizer: 'Broadway Productions',
    category: 'Theater',
    imageUrl: 'https://tickettoken.app/assets/tickets/hamilton-orchestra.png',
    animationUrl: 'https://tickettoken.app/assets/tickets/hamilton-orchestra.mp4',
    externalUrl: 'https://tickettoken.app/event/evt_hamilton_nov12_2025',
    creators: creators,
    custom: {
      intermission: 'Yes',
      programIncluded: 'Digital',
      runTime: '2h 45m'
    }
  };
  
  const metadata = createTicketMetadata(ticketData);
  writeMetadataFile('theater-orchestra-ticket.json', metadata);
}

// Execute generator if this file is run directly
if (require.main === module) {
  generateExampleMetadata();
}

// Export functions
module.exports = {
  generateExampleMetadata
};
