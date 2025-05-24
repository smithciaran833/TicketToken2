// controllers/ticketController.js - Ticket management controller

const Ticket = require('../models/Ticket');
const Event = require('../models/Event');
const Transaction = require('../models/Transaction');
const { v4: uuidv4 } = require('uuid');
const { sendSuccess, sendError, sendNotFound } = require('../utils/responseHelper');

/**
 * @desc    Get all tickets for an event
 * @route   GET /api/tickets/event/:eventId
 * @access  Public
 */
const getTicketsByEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    // Verify that the event exists
    const event = await Event.findOne({ eventId });
    
    if (!event) {
      return sendNotFound(res, 'Event');
    }
    
    // Get all tickets for this event
    const tickets = await Ticket.find({ event: event._id })
      .populate('owner', 'displayName username')
      .sort({ purchaseDate: -1 });
    
    return sendSuccess(res, { tickets, count: tickets.length }, 'Tickets retrieved successfully');
  } catch (error) {
    console.error('Get tickets by event error:', error);
    return sendError(res, 'Error retrieving tickets', { server: error.message }, 500);
  }
};

/**
 * @desc    Get all tickets owned by a user
 * @route   GET /api/tickets/user/:userId
 * @access  Private
 */
const getTicketsByUser = async (req, res) => {
  try {
    const userId = req.params.userId || req.user._id;
    
    // Check if the user has permission to view these tickets
    if (userId !== req.user._id.toString() && req.user.role !== 'admin') {
      return sendError(res, 'Not authorized', { auth: 'You can only view your own tickets' }, 403);
    }
    
    // Get all tickets owned by the user
    const tickets = await Ticket.find({ owner: userId })
      .populate('event', 'title startDate endDate')
      .sort({ purchaseDate: -1 });
    
    return sendSuccess(res, { tickets, count: tickets.length }, 'User tickets retrieved successfully');
  } catch (error) {
    console.error('Get tickets by user error:', error);
    return sendError(res, 'Error retrieving tickets', { server: error.message }, 500);
  }
};

/**
 * @desc    Purchase a ticket
 * @route   POST /api/tickets/purchase
 * @access  Private
 */
const purchaseTicket = async (req, res) => {
  try {
    const { eventId, ticketType, quantity = 1 } = req.body;
    
    if (!eventId || !ticketType) {
      return sendError(res, 'Missing required fields', {
        eventId: !eventId ? 'Event ID is required' : undefined,
        ticketType: !ticketType ? 'Ticket type is required' : undefined
      });
    }
    
    // Verify that the event exists
    const event = await Event.findOne({ eventId });
    
    if (!event) {
      return sendNotFound(res, 'Event');
    }
    
    // Find the ticket type
    const ticketTypeObj = event.ticketTypes.find(tt => tt.name === ticketType);
    
    if (!ticketTypeObj) {
      return sendError(res, 'Invalid ticket type', { ticketType: 'Ticket type not found for this event' });
    }
    
    // Check if tickets are available
    if (ticketTypeObj.remaining < quantity) {
      return sendError(res, 'Not enough tickets available', { 
        quantity: `Only ${ticketTypeObj.remaining} tickets available` 
      });
    }
    
    // Calculate total price
    const totalPrice = ticketTypeObj.price * quantity;
    
    // Create transaction record
    const transactionId = uuidv4();
    const transaction = await Transaction.create({
      transactionId,
      type: 'primary_purchase',
      buyer: req.user._id,
      totalAmount: totalPrice,
      status: 'pending',
      createdAt: new Date()
    });
    
    // Create tickets
    const ticketPromises = [];
    const tickets = [];
    
    for (let i = 0; i < quantity; i++) {
      const ticketId = uuidv4();
      const serialNumber = await getNextSerialNumber(event._id, ticketType);
      
      const ticket = new Ticket({
        ticketId,
        serialNumber,
        event: event._id,
        ticketType,
        owner: req.user._id,
        purchasePrice: ticketTypeObj.price,
        purchaseDate: new Date(),
        status: 'active',
        nftData: {
          // This would be populated after minting the NFT
        }
      });
      
      tickets.push(ticket);
      ticketPromises.push(ticket.save());
    }
    
    await Promise.all(ticketPromises);
    
    // Update transaction with tickets
    transaction.tickets = tickets.map(ticket => ({
      ticket: ticket._id,
      price: ticketTypeObj.price
    }));
    
    transaction.status = 'completed';
    transaction.completedAt = new Date();
    await transaction.save();
    
    // Update ticket quantity in event
    ticketTypeObj.remaining -= quantity;
    await event.save();
    
    // Mint NFT for tickets (would call blockchain service in production)
    // This is a placeholder for the actual blockchain integration
    const mintingResult = await mintTicketNFTs(tickets, event, req.user);
    
    return sendSuccess(res, { 
      tickets,
      transaction,
      mintingResult
    }, 'Tickets purchased successfully', 201);
  } catch (error) {
    console.error('Purchase ticket error:', error);
    return sendError(res, 'Error purchasing tickets', { server: error.message }, 500);
  }
};

/**
 * @desc    Transfer a ticket to another user
 * @route   POST /api/tickets/transfer
 * @access  Private
 */
const transferTicket = async (req, res) => {
  try {
    const { ticketId, recipientUserId, recipientWalletAddress } = req.body;
    
    if (!ticketId || (!recipientUserId && !recipientWalletAddress)) {
      return sendError(res, 'Missing required fields', {
        ticketId: !ticketId ? 'Ticket ID is required' : undefined,
        recipient: !recipientUserId && !recipientWalletAddress ? 'Recipient user ID or wallet address is required' : undefined
      });
    }
    
    // Find the ticket
    const ticket = await Ticket.findOne({ ticketId });
    
    if (!ticket) {
      return sendNotFound(res, 'Ticket');
    }
    
    // Check if the user owns this ticket
    if (ticket.owner.toString() !== req.user._id.toString()) {
      return sendError(res, 'Not authorized', { auth: 'You can only transfer tickets you own' }, 403);
    }
    
    // Check if the ticket is transferable
    if (ticket.status !== 'active') {
      return sendError(res, 'Ticket not transferable', { status: `Ticket is ${ticket.status}` });
    }
    
    // Find recipient user
    let recipientUser;
    if (recipientUserId) {
      recipientUser = await User.findById(recipientUserId);
      
      if (!recipientUser) {
        return sendNotFound(res, 'Recipient user');
      }
    } else {
      // Find user by wallet address
      recipientUser = await User.findOne({ 'walletAddresses.address': recipientWalletAddress });
      
      if (!recipientUser) {
        return sendError(res, 'Recipient not found', { wallet: 'No user found with this wallet address' });
      }
    }
    
    // Add to transfer history
    ticket.transferHistory.push({
      fromUser: req.user._id,
      toUser: recipientUser._id,
      date: new Date()
    });
    
    // Update ownership
    ticket.owner = recipientUser._id;
    
    await ticket.save();
    
    // Transfer NFT ownership on blockchain (placeholder for actual implementation)
    // This is where the blockchain integration would happen
    const transferResult = await transferTicketNFT(ticket, req.user._id, recipientUser._id);
    
    return sendSuccess(res, { 
      ticket,
      recipient: {
        _id: recipientUser._id,
        displayName: recipientUser.displayName
      },
      transferResult
    }, 'Ticket transferred successfully');
  } catch (error) {
    console.error('Transfer ticket error:', error);
    return sendError(res, 'Error transferring ticket', { server: error.message }, 500);
  }
};

/**
 * @desc    Verify a ticket for event entry
 * @route   POST /api/tickets/verify
 * @access  Private (Organizers only)
 */
const verifyTicket = async (req, res) => {
  try {
    const { ticketId } = req.body;
    
    if (!ticketId) {
      return sendError(res, 'Ticket ID is required', { ticketId: 'This field is required' });
    }
    
    // Find the ticket
    const ticket = await Ticket.findOne({ ticketId })
      .populate('event', 'title startDate endDate')
      .populate('owner', 'displayName username');
    
    if (!ticket) {
      return sendNotFound(res, 'Ticket');
    }
    
    // Check if the ticket is valid
    if (ticket.status !== 'active') {
      return sendError(res, 'Invalid ticket', { status: `Ticket is ${ticket.status}` });
    }
    
    // Check if ticket already used
    if (ticket.isCheckedIn) {
      return sendError(res, 'Ticket already used', { 
        checkedIn: `Ticket was used at ${ticket.checkedInAt}` 
      });
    }
    
    // Verify on blockchain if needed (placeholder for actual implementation)
    // This is where you would verify the NFT authenticity on the blockchain
    const verificationResult = await verifyTicketOnChain(ticket);
    
    if (!verificationResult.verified) {
      return sendError(res, 'Blockchain verification failed', { blockchain: verificationResult.reason });
    }
    
    // Mark ticket as used
    ticket.isCheckedIn = true;
    ticket.checkedInAt = new Date();
    ticket.status = 'used';
    
    await ticket.save();
    
    return sendSuccess(res, { 
      ticket,
      event: ticket.event,
      owner: ticket.owner,
      verificationResult
    }, 'Ticket verified successfully');
  } catch (error) {
    console.error('Verify ticket error:', error);
    return sendError(res, 'Error verifying ticket', { server: error.message }, 500);
  }
};

/**
 * @desc    Get ticket details by ID
 * @route   GET /api/tickets/:id
 * @access  Private
 */
const getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the ticket
    const ticket = await Ticket.findOne({ ticketId: id })
      .populate('event', 'title startDate endDate location')
      .populate('owner', 'displayName username');
    
    if (!ticket) {
      return sendNotFound(res, 'Ticket');
    }
    
    // Check if user has permission to view this ticket
    if (ticket.owner._id.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin' && 
        req.user._id.toString() !== ticket.event.organizer.toString()) {
      return sendError(res, 'Not authorized', { auth: 'You do not have permission to view this ticket' }, 403);
    }
    
    return sendSuccess(res, { ticket }, 'Ticket retrieved successfully');
  } catch (error) {
    console.error('Get ticket error:', error);
    return sendError(res, 'Error retrieving ticket', { server: error.message }, 500);
  }
};

// Helper function to generate sequential serial numbers
const getNextSerialNumber = async (eventId, ticketType) => {
  const latestTicket = await Ticket.findOne({ 
    event: eventId,
    ticketType
  }).sort({ serialNumber: -1 });
  
  return latestTicket ? latestTicket.serialNumber + 1 : 1;
};

// Placeholder for NFT minting function
// In a real implementation, this would integrate with your blockchain services
const mintTicketNFTs = async (tickets, event, user) => {
  // Placeholder implementation - in production, this would call your blockchain service
  console.log(`Minting ${tickets.length} tickets for event ${event.title} for user ${user.displayName}`);
  
  // For demonstration purposes only
  return {
    success: true,
    message: `${tickets.length} NFTs minted successfully`,
    transactions: tickets.map((ticket, index) => ({
      ticketId: ticket.ticketId,
      mintTxId: `mock-transaction-${uuidv4()}`,
      mintAddress: `mock-address-${uuidv4()}`
    }))
  };
};

// Placeholder for NFT transfer function
// In a real implementation, this would integrate with your blockchain services
const transferTicketNFT = async (ticket, fromUserId, toUserId) => {
  // Placeholder implementation
  console.log(`Transferring ticket ${ticket.ticketId} from ${fromUserId} to ${toUserId}`);
  
  // For demonstration purposes only
  return {
    success: true,
    message: 'NFT transferred successfully',
    transaction: `mock-transfer-transaction-${uuidv4()}`
  };
};

// Placeholder for blockchain ticket verification
// In a real implementation, this would integrate with your blockchain services
const verifyTicketOnChain = async (ticket) => {
  // Placeholder implementation
  console.log(`Verifying ticket ${ticket.ticketId} on blockchain`);
  
  // For demonstration purposes only
  return {
    verified: true,
    message: 'NFT verification successful',
    timestamp: new Date()
  };
};

module.exports = {
  getTicketsByEvent,
  getTicketsByUser,
  purchaseTicket,
  transferTicket,
  verifyTicket,
  getTicketById
};
