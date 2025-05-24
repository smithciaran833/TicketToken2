const { PublicKey, Keypair, Transaction } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const EventModel = require('../../models/Event');
const TicketModel = require('../../models/Ticket');
const PurchaseModel = require('../../models/Purchase');
const UserModel = require('../../models/User');
const InventoryModel = require('../../models/Inventory');
const PaymentService = require('../payment/paymentService');
const BlockchainService = require('../blockchain/blockchainService');
const NotificationService = require('../notifications/notificationService');
const EmailService = require('../email/emailService');
const CacheService = require('../cache/cacheService');
const QRCodeService = require('../qrcode/qrcodeService');
const TaxService = require('../tax/taxService');
const { AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const BigNumber = require('bignumber.js');

class PurchaseService {
  constructor() {
    this.paymentService = new PaymentService();
    this.blockchainService = new BlockchainService();
    this.notificationService = new NotificationService();
    this.emailService = new EmailService();
    this.cacheService = new CacheService();
    this.qrCodeService = new QRCodeService();
    this.taxService = new TaxService();
    
    // Configuration
    this.config = {
      maxTicketsPerPurchase: 10,
      purchaseTimeout: 10 * 60 * 1000, // 10 minutes
      reservationDuration: 15 * 60 * 1000, // 15 minutes
      platformFee: {
        percentage: 2.5, // 2.5%
        fixed: 0.30 // $0.30 per ticket
      },
      paymentMethods: ['card', 'crypto', 'bank_transfer'],
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'SOL', 'USDC'],
      retryAttempts: 3,
      retryDelay: 5000 // 5 seconds
    };
    
    // Start cleanup job for expired reservations
    this.startReservationCleanup();
  }

  /**
   * Process a ticket purchase
   */
  async processPurchase(eventId, quantity, buyerId, paymentData) {
    const session = await PurchaseModel.startSession();
    session.startTransaction();
    
    const purchaseId = crypto.randomBytes(16).toString('hex');
    let reservationId = null;
    
    try {
      logger.info('Starting ticket purchase', {
        purchaseId,
        eventId,
        quantity,
        buyerId
      });

      // Get event details
      const event = await EventModel.findById(eventId)
        .populate('organizerId')
        .session(session);
      
      if (!event) {
        throw new AppError('Event not found', 404);
      }

      if (event.status !== 'active' && event.status !== 'on_sale') {
        throw new AppError('Event is not available for purchase', 400);
      }

      // Get buyer details
      const buyer = await UserModel.findById(buyerId).session(session);
      if (!buyer) {
        throw new AppError('Buyer not found', 404);
      }

      // Validate purchase
      const validation = await this.validatePurchase({
        eventId,
        quantity,
        buyerId,
        paymentData,
        event,
        buyer
      });

      if (!validation.isValid) {
        throw new AppError(validation.error, 400);
      }

      // Check ticket availability and reserve
      const availability = await this.checkAvailability(
        eventId,
        quantity,
        paymentData.ticketTier || 'general',
        session
      );

      if (!availability.available) {
        throw new AppError(availability.reason || 'Tickets not available', 400);
      }

      // Reserve tickets
      reservationId = await this.reserveTickets(
        eventId,
        quantity,
        buyerId,
        availability.tickets,
        session
      );

      // Calculate total price
      const pricing = await this.calculateTotalPrice(
        availability.tickets,
        event,
        buyer,
        paymentData
      );

      // Create purchase record
      const purchase = new PurchaseModel({
        purchaseId,
        eventId,
        buyerId,
        status: 'pending',
        tickets: availability.tickets.map(ticket => ({
          ticketId: ticket._id,
          tier: ticket.tier,
          price: ticket.price,
          seatInfo: ticket.seatInfo
        })),
        pricing: {
          subtotal: pricing.subtotal,
          platformFee: pricing.platformFee,
          taxes: pricing.taxes,
          total: pricing.total,
          currency: paymentData.currency || 'USD'
        },
        payment: {
          method: paymentData.method,
          status: 'pending'
        },
        reservation: {
          id: reservationId,
          expiresAt: new Date(Date.now() + this.config.reservationDuration)
        },
        metadata: {
          userAgent: paymentData.userAgent,
          ipAddress: paymentData.ipAddress,
          purchaseDate: new Date()
        }
      });

      await purchase.save({ session });

      // Process payment
      const paymentResult = await this.handlePaymentProcessing(
        purchase,
        paymentData,
        pricing
      );

      if (!paymentResult.success) {
        throw new AppError(paymentResult.error || 'Payment failed', 400);
      }

      // Update purchase with payment info
      purchase.payment = {
        ...purchase.payment,
        status: 'completed',
        transactionId: paymentResult.transactionId,
        paymentIntentId: paymentResult.paymentIntentId,
        processedAt: new Date()
      };

      // Mint NFT tickets on blockchain
      const mintingResults = await this.mintTicketNFTs(
        purchase,
        event,
        buyer,
        availability.tickets
      );

      // Create ticket records
      const ticketRecords = [];
      for (let i = 0; i < availability.tickets.length; i++) {
        const ticketData = availability.tickets[i];
        const mintResult = mintingResults[i];

        const ticket = new TicketModel({
          eventId,
          userId: buyerId,
          purchaseId: purchase._id,
          ticketNumber: this.generateTicketNumber(event, i),
          tier: ticketData.tier,
          price: ticketData.price,
          status: 'active',
          blockchain: {
            mintAddress: mintResult.mintAddress,
            transactionSignature: mintResult.signature,
            metadataUri: mintResult.metadataUri
          },
          seatInfo: ticketData.seatInfo,
          qrCode: await this.generateTicketQRCode(purchase._id, ticketData),
          metadata: await this.generateTicketMetadata(event, ticketData, buyer)
        });

        await ticket.save({ session });
        ticketRecords.push(ticket);
      }

      // Update purchase with ticket info
      purchase.tickets = ticketRecords.map(t => ({
        ticketId: t._id,
        ticketNumber: t.ticketNumber,
        mintAddress: t.blockchain.mintAddress
      }));
      purchase.status = 'completed';
      purchase.completedAt = new Date();

      await purchase.save({ session });

      // Update inventory
      await this.updateInventory(eventId, availability.tickets, session);

      // Release reservation
      await this.releaseReservation(reservationId);

      // Commit transaction
      await session.commitTransaction();

      // Post-purchase operations (non-transactional)
      await this.performPostPurchaseOperations(purchase, ticketRecords, event, buyer);

      logger.info('Purchase completed successfully', {
        purchaseId: purchase.purchaseId,
        ticketCount: ticketRecords.length
      });

      return {
        success: true,
        purchase: {
          id: purchase._id,
          purchaseId: purchase.purchaseId,
          tickets: ticketRecords.map(t => ({
            id: t._id,
            ticketNumber: t.ticketNumber,
            tier: t.tier,
            mintAddress: t.blockchain.mintAddress,
            qrCode: t.qrCode
          })),
          pricing: purchase.pricing,
          receipt: await this.generateReceipt(purchase._id)
        }
      };

    } catch (error) {
      await session.abortTransaction();
      
      // Release reservation if exists
      if (reservationId) {
        await this.releaseReservation(reservationId);
      }

      logger.error('Error processing purchase:', error);
      
      // Handle purchase failure
      await this.handlePurchaseFailure(purchaseId, error);
      
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Validate purchase data
   */
  async validatePurchase(purchaseData) {
    const errors = [];

    // Validate quantity
    if (!purchaseData.quantity || purchaseData.quantity < 1) {
      errors.push('Invalid ticket quantity');
    }

    if (purchaseData.quantity > this.config.maxTicketsPerPurchase) {
      errors.push(`Maximum ${this.config.maxTicketsPerPurchase} tickets per purchase`);
    }

    // Validate event
    if (!purchaseData.event) {
      errors.push('Event information missing');
    } else {
      // Check event date
      const eventDate = new Date(purchaseData.event.startDate);
      if (eventDate < new Date()) {
        errors.push('Cannot purchase tickets for past events');
      }

      // Check sale period
      if (purchaseData.event.saleStartDate && new Date() < new Date(purchaseData.event.saleStartDate)) {
        errors.push('Ticket sales have not started yet');
      }

      if (purchaseData.event.saleEndDate && new Date() > new Date(purchaseData.event.saleEndDate)) {
        errors.push('Ticket sales have ended');
      }
    }

    // Validate buyer
    if (!purchaseData.buyer) {
      errors.push('Buyer information missing');
    } else {
      // Check if buyer is verified
      if (purchaseData.event.requiresVerification && !purchaseData.buyer.isVerified) {
        errors.push('Account verification required for this event');
      }

      // Check purchase limits
      const existingPurchases = await this.getUserPurchasesForEvent(
        purchaseData.buyerId,
        purchaseData.eventId
      );

      const totalTickets = existingPurchases.reduce((sum, p) => sum + p.tickets.length, 0);
      const maxPerUser = purchaseData.event.maxTicketsPerUser || 10;

      if (totalTickets + purchaseData.quantity > maxPerUser) {
        errors.push(`Maximum ${maxPerUser} tickets per user for this event`);
      }
    }

    // Validate payment data
    if (!purchaseData.paymentData) {
      errors.push('Payment information missing');
    } else {
      if (!this.config.paymentMethods.includes(purchaseData.paymentData.method)) {
        errors.push('Invalid payment method');
      }

      // Method-specific validation
      switch (purchaseData.paymentData.method) {
        case 'card':
          if (!purchaseData.paymentData.paymentMethodId && !purchaseData.paymentData.token) {
            errors.push('Payment method ID or token required');
          }
          break;
        case 'crypto':
          if (!purchaseData.paymentData.walletAddress) {
            errors.push('Wallet address required for crypto payment');
          }
          break;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      error: errors[0] || null
    };
  }

  /**
   * Check ticket availability
   */
  async checkAvailability(eventId, quantity, tier, session) {
    try {
      // Get inventory with lock
      const inventory = await InventoryModel.findOne({ eventId }).session(session);
      
      if (!inventory) {
        return { available: false, reason: 'Inventory not found' };
      }

      // Check tier availability
      const tierInventory = inventory.tiers[tier];
      if (!tierInventory) {
        return { available: false, reason: 'Invalid ticket tier' };
      }

      const available = tierInventory.total - tierInventory.sold - tierInventory.reserved;
      
      if (available < quantity) {
        return { 
          available: false, 
          reason: `Only ${available} tickets available`,
          availableCount: available
        };
      }

      // Get specific tickets/seats
      let tickets = [];
      
      if (inventory.seatingEnabled) {
        // Seated event - find available seats
        tickets = await this.findAvailableSeats(eventId, tier, quantity, session);
      } else {
        // General admission - create ticket placeholders
        for (let i = 0; i < quantity; i++) {
          tickets.push({
            tier,
            price: tierInventory.price,
            seatInfo: null
          });
        }
      }

      return {
        available: true,
        tickets,
        inventory: {
          total: tierInventory.total,
          sold: tierInventory.sold,
          available
        }
      };
    } catch (error) {
      logger.error('Error checking availability:', error);
      return { available: false, reason: 'Error checking availability' };
    }
  }

  /**
   * Calculate total price including fees and taxes
   */
  async calculateTotalPrice(tickets, event, buyer, paymentData) {
    try {
      const calculations = new BigNumber(0);
      
      // Calculate subtotal
      let subtotal = new BigNumber(0);
      for (const ticket of tickets) {
        subtotal = subtotal.plus(ticket.price);
      }

      // Calculate platform fees
      const platformPercentageFee = subtotal
        .multipliedBy(this.config.platformFee.percentage)
        .dividedBy(100);
      
      const platformFixedFee = new BigNumber(this.config.platformFee.fixed)
        .multipliedBy(tickets.length);
      
      const totalPlatformFee = platformPercentageFee.plus(platformFixedFee);

      // Calculate taxes
      const taxableAmount = subtotal.plus(totalPlatformFee);
      const taxes = await this.taxService.calculateTaxes({
        amount: taxableAmount.toNumber(),
        eventLocation: event.venue?.address || event.location,
        buyerLocation: buyer.address || buyer.location,
        eventType: event.type,
        currency: paymentData.currency || 'USD'
      });

      // Calculate total
      const total = subtotal
        .plus(totalPlatformFee)
        .plus(taxes.totalTax);

      // Apply any discounts
      let discount = new BigNumber(0);
      if (paymentData.discountCode) {
        const discountResult = await this.applyDiscountCode(
          paymentData.discountCode,
          total,
          event._id
        );
        if (discountResult.valid) {
          discount = discountResult.amount;
        }
      }

      const finalTotal = total.minus(discount);

      return {
        subtotal: subtotal.toNumber(),
        platformFee: totalPlatformFee.toNumber(),
        taxes: {
          total: taxes.totalTax,
          breakdown: taxes.breakdown
        },
        discount: discount.toNumber(),
        total: finalTotal.toNumber(),
        currency: paymentData.currency || 'USD',
        breakdown: {
          ticketPrices: tickets.map(t => ({
            tier: t.tier,
            price: t.price,
            seat: t.seatInfo?.seatNumber
          })),
          fees: {
            platform: {
              percentage: platformPercentageFee.toNumber(),
              fixed: platformFixedFee.toNumber()
            }
          }
        }
      };
    } catch (error) {
      logger.error('Error calculating total price:', error);
      throw error;
    }
  }

  /**
   * Handle payment processing
   */
  async handlePaymentProcessing(purchase, paymentData, pricing) {
    try {
      let result;

      switch (paymentData.method) {
        case 'card':
          result = await this.processCardPayment(purchase, paymentData, pricing);
          break;
        
        case 'crypto':
          result = await this.processCryptoPayment(purchase, paymentData, pricing);
          break;
        
        case 'bank_transfer':
          result = await this.processBankTransfer(purchase, paymentData, pricing);
          break;
        
        default:
          throw new AppError('Unsupported payment method', 400);
      }

      // Record payment transaction
      await this.recordPaymentTransaction(purchase, result, pricing);

      return result;
    } catch (error) {
      logger.error('Error processing payment:', error);
      
      // Log failed payment attempt
      await this.logPaymentAttempt(purchase, error, paymentData);
      
      throw error;
    }
  }

  /**
   * Process card payment through Stripe
   */
  async processCardPayment(purchase, paymentData, pricing) {
    try {
      // Create or retrieve customer
      let customerId = paymentData.customerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: paymentData.email,
          metadata: {
            userId: purchase.buyerId.toString()
          }
        });
        customerId = customer.id;
      }

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(pricing.total * 100), // Convert to cents
        currency: pricing.currency.toLowerCase(),
        customer: customerId,
        payment_method: paymentData.paymentMethodId,
        confirmation_method: 'automatic',
        confirm: true,
        metadata: {
          purchaseId: purchase.purchaseId,
          eventId: purchase.eventId.toString(),
          ticketCount: purchase.tickets.length.toString()
        },
        description: `Tickets for ${purchase.eventId.name}`,
        receipt_email: paymentData.email
      });

      // Wait for payment confirmation
      if (paymentIntent.status === 'requires_action') {
        // Handle 3D Secure or other actions
        return {
          success: false,
          requiresAction: true,
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id
        };
      }

      if (paymentIntent.status !== 'succeeded') {
        throw new AppError('Payment failed', 400);
      }

      return {
        success: true,
        transactionId: paymentIntent.id,
        paymentIntentId: paymentIntent.id,
        customerId,
        receiptUrl: paymentIntent.charges.data[0]?.receipt_url
      };
    } catch (error) {
      logger.error('Stripe payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process cryptocurrency payment
   */
  async processCryptoPayment(purchase, paymentData, pricing) {
    try {
      // Convert price to crypto
      const cryptoAmount = await this.convertToCrypto(
        pricing.total,
        pricing.currency,
        paymentData.cryptocurrency || 'SOL'
      );

      // Create payment transaction on blockchain
      const paymentResult = await this.blockchainService.processPayment({
        from: new PublicKey(paymentData.walletAddress),
        amount: new BN(cryptoAmount * 1e9), // Convert to lamports for SOL
        purchaseId: purchase.purchaseId,
        metadata: {
          eventId: purchase.eventId.toString(),
          ticketCount: purchase.tickets.length
        }
      });

      // Wait for confirmation
      const confirmed = await this.blockchainService.confirmTransaction(
        paymentResult.signature
      );

      if (!confirmed) {
        throw new AppError('Crypto payment not confirmed', 400);
      }

      return {
        success: true,
        transactionId: paymentResult.signature,
        walletAddress: paymentData.walletAddress,
        amount: cryptoAmount,
        cryptocurrency: paymentData.cryptocurrency || 'SOL'
      };
    } catch (error) {
      logger.error('Crypto payment error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process bank transfer payment
   */
  async processBankTransfer(purchase, paymentData, pricing) {
    // Bank transfers are typically processed asynchronously
    // Create a pending payment record
    return {
      success: true,
      pending: true,
      referenceNumber: this.generateBankTransferReference(purchase),
      instructions: {
        accountNumber: process.env.BANK_ACCOUNT_NUMBER,
        routingNumber: process.env.BANK_ROUTING_NUMBER,
        reference: purchase.purchaseId,
        amount: pricing.total,
        currency: pricing.currency
      }
    };
  }

  /**
   * Mint ticket NFTs on blockchain
   */
  async mintTicketNFTs(purchase, event, buyer, tickets) {
    const mintingResults = [];

    try {
      for (const ticket of tickets) {
        // Generate NFT metadata
        const metadata = await this.generateTicketMetadata(event, ticket, buyer);
        
        // Upload metadata to IPFS or Arweave
        const metadataUri = await this.uploadMetadata(metadata);
        
        // Mint NFT on blockchain
        const mintResult = await this.blockchainService.mintTicketNFT({
          owner: new PublicKey(buyer.walletAddress),
          metadata: metadataUri,
          eventId: event._id.toString(),
          ticketTier: ticket.tier,
          purchaseId: purchase.purchaseId
        });

        mintingResults.push({
          success: true,
          mintAddress: mintResult.mint.toBase58(),
          signature: mintResult.signature,
          metadataUri
        });
      }

      return mintingResults;
    } catch (error) {
      logger.error('Error minting NFTs:', error);
      
      // Return partial results if some succeeded
      return tickets.map((_, index) => 
        mintingResults[index] || {
          success: false,
          error: error.message
        }
      );
    }
  }

  /**
   * Generate ticket NFT metadata
   */
  async generateTicketMetadata(event, ticketData, buyer) {
    const metadata = {
      name: `${event.name} - ${ticketData.tier} Ticket`,
      symbol: event.symbol || 'TICKET',
      description: `Official ticket for ${event.name}`,
      image: event.images?.ticket || event.images?.main || '',
      attributes: [
        {
          trait_type: 'Event',
          value: event.name
        },
        {
          trait_type: 'Date',
          value: new Date(event.startDate).toISOString()
        },
        {
          trait_type: 'Venue',
          value: event.venue?.name || event.location
        },
        {
          trait_type: 'Tier',
          value: ticketData.tier
        },
        {
          trait_type: 'Original Price',
          value: ticketData.price,
          display_type: 'number'
        }
      ],
      properties: {
        category: 'ticket',
        creators: [
          {
            address: event.organizerId.walletAddress,
            share: 100
          }
        ],
        files: [
          {
            uri: event.images?.ticket || event.images?.main || '',
            type: 'image/png'
          }
        ]
      },
      collection: {
        name: event.name,
        family: 'Event Tickets'
      }
    };

    // Add seat info if applicable
    if (ticketData.seatInfo) {
      metadata.attributes.push(
        {
          trait_type: 'Section',
          value: ticketData.seatInfo.section
        },
        {
          trait_type: 'Row',
          value: ticketData.seatInfo.row
        },
        {
          trait_type: 'Seat',
          value: ticketData.seatInfo.seatNumber
        }
      );
    }

    // Add special attributes
    if (ticketData.tier === 'VIP') {
      metadata.attributes.push({
        trait_type: 'Benefits',
        value: 'Meet & Greet, Early Entry, Exclusive Merchandise'
      });
    }

    return metadata;
  }

  /**
   * Send purchase confirmation
   */
  async sendPurchaseConfirmation(buyerId, ticketData) {
    try {
      const buyer = await UserModel.findById(buyerId);
      if (!buyer) return;

      // Send email confirmation
      await this.emailService.sendPurchaseConfirmation({
        to: buyer.email,
        name: buyer.name || buyer.username,
        purchase: ticketData.purchase,
        tickets: ticketData.tickets,
        event: ticketData.event,
        receiptUrl: ticketData.receiptUrl
      });

      // Send push notification
      await this.notificationService.sendNotification({
        userId: buyerId,
        type: 'purchase_confirmation',
        title: 'Purchase Confirmed!',
        message: `Your tickets for ${ticketData.event.name} are ready`,
        data: {
          purchaseId: ticketData.purchase.id,
          ticketCount: ticketData.tickets.length
        }
      });

      // Send SMS if enabled
      if (buyer.phone && buyer.preferences?.smsNotifications) {
        await this.sendSMSConfirmation(buyer.phone, ticketData);
      }

      return { success: true };
    } catch (error) {
      logger.error('Error sending purchase confirmation:', error);
      // Don't throw - confirmation is not critical
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle purchase failure and cleanup
   */
  async handlePurchaseFailure(purchaseId, error) {
    try {
      // Log failure
      await PurchaseModel.findOneAndUpdate(
        { purchaseId },
        {
          status: 'failed',
          failureReason: error.message,
          failedAt: new Date()
        }
      );

      // Send failure notification
      const purchase = await PurchaseModel.findOne({ purchaseId });
      if (purchase) {
        await this.notificationService.sendNotification({
          userId: purchase.buyerId,
          type: 'purchase_failed',
          title: 'Purchase Failed',
          message: 'We were unable to complete your ticket purchase',
          data: {
            purchaseId,
            reason: error.message
          }
        });
      }

      // Clean up any partial data
      await this.cleanupFailedPurchase(purchaseId);

      logger.info('Purchase failure handled', { purchaseId });
    } catch (cleanupError) {
      logger.error('Error handling purchase failure:', cleanupError);
    }
  }

  /**
   * Generate detailed receipt
   */
  async generateReceipt(purchaseId) {
    try {
      const purchase = await PurchaseModel.findById(purchaseId)
        .populate('eventId')
        .populate('buyerId')
        .populate('tickets.ticketId');

      if (!purchase) {
        throw new AppError('Purchase not found', 404);
      }

      const receipt = {
        receiptNumber: `RCP-${purchase.purchaseId}`,
        date: purchase.metadata.purchaseDate,
        buyer: {
          name: purchase.buyerId.name || purchase.buyerId.username,
          email: purchase.buyerId.email,
          userId: purchase.buyerId._id
        },
        event: {
          name: purchase.eventId.name,
          date: purchase.eventId.startDate,
          venue: purchase.eventId.venue?.name || purchase.eventId.location
        },
        tickets: purchase.tickets.map(t => ({
          ticketNumber: t.ticketNumber,
          tier: t.tier,
          price: t.price,
          seat: t.seatInfo
        })),
        pricing: {
          subtotal: purchase.pricing.subtotal,
          fees: purchase.pricing.platformFee,
          taxes: purchase.pricing.taxes,
          discount: purchase.pricing.discount || 0,
          total: purchase.pricing.total,
          currency: purchase.pricing.currency
        },
        payment: {
          method: purchase.payment.method,
          last4: purchase.payment.last4,
          transactionId: purchase.payment.transactionId
        },
        qrCode: await this.generateReceiptQRCode(purchase),
        downloadUrl: `${process.env.APP_URL}/receipts/${purchase.purchaseId}`
      };

      // Generate PDF receipt
      const pdfUrl = await this.generatePDFReceipt(receipt);
      receipt.pdfUrl = pdfUrl;

      return receipt;
    } catch (error) {
      logger.error('Error generating receipt:', error);
      throw error;
    }
  }

  // Helper methods

  async reserveTickets(eventId, quantity, buyerId, tickets, session) {
    const reservationId = crypto.randomBytes(16).toString('hex');
    
    // Update inventory with reservation
    await InventoryModel.findOneAndUpdate(
      { eventId },
      {
        $inc: { 
          [`tiers.${tickets[0].tier}.reserved`]: quantity 
        },
        $push: {
          reservations: {
            id: reservationId,
            buyerId,
            quantity,
            tickets,
            expiresAt: new Date(Date.now() + this.config.reservationDuration)
          }
        }
      },
      { session }
    );

    return reservationId;
  }

  async releaseReservation(reservationId) {
    try {
      const inventory = await InventoryModel.findOne({
        'reservations.id': reservationId
      });

      if (!inventory) return;

      const reservation = inventory.reservations.find(r => r.id === reservationId);
      if (!reservation) return;

      await InventoryModel.findByIdAndUpdate(inventory._id, {
        $inc: { 
          [`tiers.${reservation.tickets[0].tier}.reserved`]: -reservation.quantity 
        },
        $pull: { reservations: { id: reservationId } }
      });

      logger.info('Reservation released', { reservationId });
    } catch (error) {
      logger.error('Error releasing reservation:', error);
    }
  }

  async getUserPurchasesForEvent(userId, eventId) {
    return await PurchaseModel.find({
      buyerId: userId,
      eventId,
      status: { $in: ['completed', 'pending'] }
    });
  }

  async findAvailableSeats(eventId, tier, quantity, session) {
    // Implementation for finding available seats in seated venues
    // This would integrate with a seating chart system
    return [];
  }

  generateTicketNumber(event, index) {
    const prefix = event.ticketPrefix || 'TKT';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}-${timestamp}-${random}-${String(index + 1).padStart(3, '0')}`;
  }

  async generateTicketQRCode(purchaseId, ticketData) {
    const qrData = {
      purchaseId,
      ticketId: ticketData._id,
      validationCode: crypto.randomBytes(16).toString('hex')
    };

    return await this.qrCodeService.generateQRCode(JSON.stringify(qrData));
  }

  async updateInventory(eventId, tickets, session) {
    const tierCounts = {};
    tickets.forEach(ticket => {
      tierCounts[ticket.tier] = (tierCounts[ticket.tier] || 0) + 1;
    });

    const updates = {};
    Object.keys(tierCounts).forEach(tier => {
      updates[`tiers.${tier}.sold`] = tierCounts[tier];
      updates[`tiers.${tier}.reserved`] = -tierCounts[tier];
    });

    await InventoryModel.findOneAndUpdate(
      { eventId },
      { $inc: updates },
      { session }
    );
  }

  async performPostPurchaseOperations(purchase, tickets, event, buyer) {
    try {
      // Send confirmation
      await this.sendPurchaseConfirmation(buyer._id, {
        purchase,
        tickets,
        event,
        receiptUrl: `${process.env.APP_URL}/receipts/${purchase.purchaseId}`
      });

      // Update analytics
      await this.updatePurchaseAnalytics(purchase, event);

      // Clear caches
      await this.cacheService.delete(`event:${event._id}:availability`);
      await this.cacheService.delete(`user:${buyer._id}:purchases`);

      // Trigger webhooks
      await this.triggerPurchaseWebhooks(purchase, event);

      // Schedule reminder notifications
      await this.scheduleEventReminders(purchase, event, buyer);

    } catch (error) {
      logger.error('Error in post-purchase operations:', error);
      // Don't throw - these are non-critical operations
    }
  }

  async applyDiscountCode(code, amount, eventId) {
    // Implement discount code validation and application
    return { valid: false, amount: 0 };
  }

  async recordPaymentTransaction(purchase, paymentResult, pricing) {
    // Record detailed payment transaction for accounting
    logger.info('Payment transaction recorded', {
      purchaseId: purchase.purchaseId,
      amount: pricing.total,
      method: purchase.payment.method
    });
  }

  async logPaymentAttempt(purchase, error, paymentData) {
    // Log failed payment attempts for analysis
    logger.warn('Payment attempt failed', {
      purchaseId: purchase.purchaseId,
      error: error.message,
      method: paymentData.method
    });
  }

  async convertToCrypto(amount, fromCurrency, toCrypto) {
    // Implement currency to crypto conversion
    // This would use a price oracle or exchange API
    return amount / 50; // Placeholder conversion rate
  }

  generateBankTransferReference(purchase) {
    return `EVT${purchase.eventId.toString().slice(-6)}${purchase.purchaseId.slice(0, 8).toUpperCase()}`;
  }

  async uploadMetadata(metadata) {
    // Upload to IPFS or Arweave
    // Return URI
    return `ipfs://QmExample${Date.now()}`;
  }

  async sendSMSConfirmation(phone, ticketData) {
    // Implement SMS sending
    logger.info('SMS confirmation sent', { phone });
  }

  async cleanupFailedPurchase(purchaseId) {
    // Clean up any partial data from failed purchase
    await TicketModel.deleteMany({ 
      purchaseId,
      status: 'pending'
    });
  }

  async generateReceiptQRCode(purchase) {
    const qrData = {
      receiptId: purchase.purchaseId,
      verificationCode: crypto.randomBytes(8).toString('hex')
    };

    return await this.qrCodeService.generateQRCode(JSON.stringify(qrData));
  }

  async generatePDFReceipt(receipt) {
    // Generate PDF receipt
    // Return URL to PDF
    return `${process.env.APP_URL}/receipts/pdf/${receipt.receiptNumber}.pdf`;
  }

  async updatePurchaseAnalytics(purchase, event) {
    // Update various analytics
    logger.info('Analytics updated', {
      purchaseId: purchase.purchaseId,
      eventId: event._id
    });
  }

  async triggerPurchaseWebhooks(purchase, event) {
    // Trigger webhooks for integrations
    logger.info('Webhooks triggered', {
      purchaseId: purchase.purchaseId
    });
  }

  async scheduleEventReminders(purchase, event, buyer) {
    // Schedule reminder notifications before event
    const reminderDates = [
      new Date(event.startDate - 7 * 24 * 60 * 60 * 1000), // 1 week before
      new Date(event.startDate - 24 * 60 * 60 * 1000), // 1 day before
      new Date(event.startDate - 2 * 60 * 60 * 1000) // 2 hours before
    ];

    for (const reminderDate of reminderDates) {
      if (reminderDate > new Date()) {
        // Schedule reminder
        logger.info('Reminder scheduled', {
          purchaseId: purchase.purchaseId,
          date: reminderDate
        });
      }
    }
  }

  startReservationCleanup() {
    setInterval(async () => {
      try {
        // Find and release expired reservations
        const expiredReservations = await InventoryModel.aggregate([
          { $unwind: '$reservations' },
          { 
            $match: { 
              'reservations.expiresAt': { $lt: new Date() } 
            } 
          },
          { $project: { 'reservations.id': 1 } }
        ]);

        for (const reservation of expiredReservations) {
          await this.releaseReservation(reservation.reservations.id);
        }
      } catch (error) {
        logger.error('Error cleaning up reservations:', error);
      }
    }, 60000); // Run every minute
  }
}

module.exports = new PurchaseService();
