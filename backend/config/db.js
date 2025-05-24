// config/db.js - Database connection setup

const mongoose = require('mongoose');

// Function to connect to the database
const connectDB = async () => {
  try {
    // MongoDB connection options
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    };
    
    // Get the MongoDB connection string from environment variables
    const conn = await mongoose.connect(process.env.MONGODB_URI, options);
    
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);  // Exit with failure
  }
};

module.exports = connectDB;
// config/database-setup.js - Database initialization information

/*
TicketToken MongoDB Collections:

1. users - User information
   - Account details
   - Profile information
   - Wallet addresses

2. events - Event information
   - Event details
   - Venue information
   - Ticket types available

3. tickets - Individual ticket data
   - Ownership information
   - NFT metadata
   - Status and history

4. listings - Marketplace listings
   - Tickets for sale
   - Pricing information
   - Listing status

5. transactions - Purchase records
   - Payment details
   - Buyer and seller information
   - Transaction status

These collections will be automatically created when data is first inserted.
The schemas defined in the models folder control the structure of documents
in these collections.
*/

console.log('Database collections documentation - no action needed');
