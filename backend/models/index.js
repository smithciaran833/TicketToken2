// index.js - Exports all models and shows relationships

// Import all models
const User = require('./user');
const Event = require('./Event');
const Ticket = require('./Ticket');
const Listing = require('./Listing');
const Transaction = require('./Transaction');
const ExclusiveContent = require('./ExclusiveContent');
const ContentAccess = require('./ContentAccess');

// Export all models
module.exports = {
  User,
  Event,
  Ticket,
  Listing,
  Transaction,
  ExclusiveContent,
  ContentAccess
};

/*
Key Relationships:

1. User
   - Can create Events (as organizer)
   - Can own Tickets
   - Can create Listings
   - Can be buyer or seller in Transactions
   - Can create ExclusiveContent (as artist)
   - Can access ExclusiveContent (with tickets)

2. Event
   - Created by a User
   - Has multiple Tickets
   - Has multiple ticket types
   - Has multiple ExclusiveContent items

3. Ticket
   - Belongs to an Event
   - Owned by a User
   - Can be listed in a Listing
   - Can be part of a Transaction
   - Grants access to ExclusiveContent

4. Listing
   - Created by a User (seller)
   - Contains one Ticket
   - References an Event

5. Transaction
   - Has a buyer (User)
   - May have a seller (User)
   - Contains one or more Tickets

6. ExclusiveContent
   - Created by a User (artist)
   - Belongs to an Event
   - Accessible through Tickets
   - Access records tracked in ContentAccess

7. ContentAccess
   - Links a User to ExclusiveContent
   - References a Ticket used for access
   - Tracks metadata about access
*/
