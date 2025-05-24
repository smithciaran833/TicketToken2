// services/ticketService.js - Ticket business logic service

const Ticket = require('../models/Ticket');
const Event = require('../models/Event');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { v4: uuidv4 } = require('uuid');
const nftVerificationService = require('./nftVerificationService');

class TicketService {
  /**
   * Purchase tickets for an event
   * @param {Object} purchaseData - Data for the purchase
   * @param {String} userId - ID of the purchasing user
   * @returns {Promise<Object>} Purchase results
   */
  static async purchaseTickets(purchaseData, userId) {
    try {
      const { eventId, ticketType, quantity = 1, paymentMethod = 'wallet' } = purchaseData;
      
      // Validate inputs
      if (!eventId || !ticketType) {
        throw new Error('Event ID and ticket type are required');
      }
      
      // Find the event
      const event = await Event.findOne({ eventId });
      if (!event) {
        throw new Error('Event not found');
      }
      
      // Find the ticket type
      const ticketTypeObj = event.ticketTypes.find(tt => tt.name === ticketType);
      if (!ticketTypeObj) {
        throw new Error(`Ticket type "${ticketType}" not found for this event`);
      }
      
      // Check if tickets are available
      if (ticketTypeObj.remaining < quantity) {
        throw new Error(`Not enough tickets available. Only ${ticketTypeObj.remaining} remaining.`);
      }
      
      // Find the user
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }
      
      // Calculate total price
      const totalPrice = ticketTypeObj.price * quantity;
      
      // Process payment (placeholder - would integrate with payment service)
      const paymentResult = await this.processPayment(userId, totalPrice, paymentMethod);
      
      if (!paymentResult.success) {
        throw new Error(`Payment failed: ${paymentResult.message}`);
      }
      
      // Create transaction record
      const transactionId = uuidv4();
      const transaction = await Transaction.create({
        transactionId,
        type: 'primary_purchase',
        buyer: userId,
        totalAmount: totalPrice,
        paymentMethod,
        status: 'pending',
        createdAt: new Date()
      });
      
      // Create tickets
      const ticketPromises = [];
      const tickets = [];
      
      for (let i = 0; i < quantity; i++) {
        const ticketId = uuidv4();
        const serialNumber = await this.getNextSerialNumber(event._id, ticketType);
        
        const ticket = new Ticket({
          ticketId,
          serialNumber,
          event: event._id,
          ticketType,
          owner: userId,
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
      
      // Mint NFT for tickets
      const mintingResult = await this.mintTicketNFTs(tickets, event, user);
      
      // Update tickets with NFT data
      for (let i = 0; i < tickets.length; i++) {
        const nftData = mintingResult.nftData[i];
        tickets[i].nftData = {
          mintAddress: nftData.mintAddress,
          imageUrl: nftData.imageUrl,
          attributes: nftData.attributes
        };
        await tickets[i].save();
      }
      
      return {
        success: true,
        tickets,
        transaction,
        mintingResult
      };
    } catch (error) {
      console.error('Purchase tickets error:', error);
      throw error;
    }
  }
  
  /**
   * Transfer a ticket to another user
   * @param {String} ticketId - ID of the ticket to transfer
   * @param {String} fromUserId - ID of the current owner
   * @param {String} toUserId - ID of the recipient
   * @returns {Promise<Object>} Transfer results
   */
  static async transferTicket(ticketId, fromUserId, toUserId) {
    try {
      // Find the ticket
      const ticket = await Ticket.findOne({ ticketId });
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      
      // Verify ownership
      if (ticket.owner.toString() !== fromUserId) {
        throw new Error('You can only transfer tickets you own');
      }
      
      // Verify status
      if (ticket.status !== 'active') {
        throw new Error(`Cannot transfer ticket with status: ${ticket.status}`);
      }
      
      // Find recipient
      const toUser = await User.findById(toUserId);
      if (!toUser) {
        throw new Error('Recipient user not found');
      }
      
      // Record transfer in history
      ticket.transferHistory.push({
        fromUser: fromUserId,
        toUser: toUserId,
        date: new Date()
      });
      
      // Update ownership
      ticket.owner = toUserId;
      
      await ticket.save();
      
      // Transfer NFT on blockchain
      const transferResult = await this.transferTicketNFT(ticket, fromUserId, toUserId);
      
      return {
        success: true,
        ticket,
        transferResult
      };
    } catch (error) {
      console.error('Transfer ticket error:', error);
      throw error;
    }
  }
  
  /**
   * Verify a ticket for event entry
   * @param {String} ticketId - ID of the ticket to verify
   * @returns {Promise<Object>} Verification results
   */
  static async verifyTicket(ticketId) {
    try {
      // Find the ticket
      const ticket = await Ticket.findOne({ ticketId })
        .populate('event', 'title startDate endDate')
        .populate('owner', 'displayName username');
      
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      
      // Check status
      if (ticket.status !== 'active') {
        throw new Error(`Invalid ticket status: ${ticket.status}`);
      }
      
      // Check if already used
      if (ticket.isCheckedIn) {
        throw new Error(`Ticket already used at ${ticket.checkedInAt}`);
      }
      
      // Verify on blockchain
      const verificationResult = await this.verifyTicketOnChain(ticket);
      
      if (!verificationResult.verified) {
        throw new Error(`Blockchain verification failed: ${verificationResult.reason}`);
      }
      
      // Mark as used
      ticket.isCheckedIn = true;
      ticket.checkedInAt = new Date();
      ticket.status = 'used';
      
      await ticket.save();
      
      return {
        success: true,
        verified: true,
        ticket,
        verificationResult
      };
    } catch (error) {
      console.error('Verify ticket error:', error);
      throw error;
    }
  }
  
  /**
   * Get all tickets for an event
   * @param {String} eventId - ID of the event
   * @returns {Promise<Array>} List of tickets
   */
  static async getTicketsByEvent(eventId) {
    try {
      // Find the event
      const event = await Event.findOne({ eventId });
      if (!event) {
        throw new Error('Event not found');
      }
      
      // Get tickets
      const tickets = await Ticket.find({ event: event._id })
        .populate('owner', 'displayName username')
        .sort({ purchaseDate: -1 });
      
      return tickets;
    } catch (error) {
      console.error('Get tickets by event error:', error);
      throw error;
    }
  }
  
  /**
   * Get all tickets owned by a user
   * @param {String} userId - ID of the user
   * @returns {Promise<Array>} List of tickets
   */
  static async getTicketsByUser(userId) {
    try {
      // Get tickets
      const tickets = await Ticket.find({ owner: userId })
        .populate('event', 'title startDate endDate')
        .sort({ purchaseDate: -1 });
      
      return tickets;
    } catch (error) {
      console.error('Get tickets by user error:', error);
      throw error;
    }
  }
  
  /**
   * Get ticket details by ID
   * @param {String} ticketId - ID of the ticket
   * @returns {Promise<Object>} Ticket details
   */
  static async getTicketById(ticketId) {
    try {
      // Find the ticket
      const ticket = await Ticket.findOne({ ticketId })
        .populate('event', 'title startDate endDate location')
        .populate('owner', 'displayName username');
      
      if (!ticket) {
        throw new Error('Ticket not found');
      }
      
      return ticket;
    } catch (error) {
      console.error('Get ticket error:', error);
      throw error;
    }
  }
  
  // Helper Methods
  
  /**
   * Generate sequential serial numbers for tickets
   * @private
   */
  static async getNextSerialNumber(eventId, ticketType) {
    const latestTicket = await Ticket.findOne({ 
      event: eventId,
      ticketType
    }).sort({ serialNumber: -1 });
    
    return latestTicket ? latestTicket.serialNumber + 1 : 1;
  }
  
  /**
   * Process payment for tickets
   * @private
   */
  static async processPayment(userId, amount, paymentMethod) {
    // Placeholder implementation
    console.log(`Processing payment for user ${userId}: ${amount} via ${paymentMethod}`);
    
    // For demo purposes - in production, this would integrate with a payment processor
    return {
      success: true,
      transactionId: `payment-${uuidv4()}`,
      amount,
      timestamp: new Date()
    };
  }
  
  /**
   * Mint NFT tickets on blockchain
   * @private
   */
  static async mintTicketNFTs(tickets, event, user) {
    // This would integrate with your blockchain service in production
    
    // Simulate blockchain integration
    console.log(`Minting ${tickets.length} NFT tickets for ${user.displayName} for event: ${event.title}`);
    
    // For demo purposes
    const nftData = tickets.map((ticket) => ({
      ticketId: ticket.ticketId,
      mintAddress: `mint-${uuidv4()}`,
      imageUrl: `https://example.com/nft-tickets/${uuidv4()}.png`,
      attributes: {
        event: event.title,
        ticketType: ticket.ticketType,
        serialNumber: ticket.serialNumber,
        issuedTo: user.displayName
      }
    }));
    
    return {
      success: true,
      nftData,
      message: `${tickets.length} NFTs minted successfully`
    };
  }
  
  /**
   * Transfer NFT ticket ownership on blockchain
   * @private
   */
  static async transferTicketNFT(ticket, fromUserId, toUserId) {
    // This would integrate with your blockchain service in production
    
    // Simulate blockchain integration
    console.log(`Transferring NFT ticket ${ticket.ticketId} from ${fromUserId} to ${toUserId}`);
    
    // For demo purposes
    return {
      success: true,
      transaction: `transfer-${uuidv4()}`,
      timestamp: new Date()
    };
  }
  
  /**
   * Verify ticket authenticity on blockchain
   * @private
   */
  static async verifyTicketOnChain(ticket) {
    // In production, this would verify with your blockchain services
    // This could use your nftVerificationService
    
    // Simulate blockchain verification
    console.log(`Verifying ticket ${ticket.ticketId} on blockchain`);
    
    // For demo purposes
    return {
      verified: true,
      message: 'Ticket NFT verification successful',
      timestamp: new Date()
    };
  }
}

module.exports = TicketService;
