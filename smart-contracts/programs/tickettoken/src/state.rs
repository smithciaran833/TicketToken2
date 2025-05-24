use anchor_lang::prelude::*;

/// Program state account
#[account]
pub struct ProgramState {
    /// Program authority
    pub authority: Pubkey,
    /// Marketplace fee in basis points (100 = 1%)
    pub marketplace_fee_bps: u16,
    /// Royalty fee in basis points (100 = 1%)
    pub royalty_fee_bps: u16,
    /// Whether the program is paused
    pub is_paused: bool,
    /// Total number of tickets minted
    pub total_tickets_minted: u64,
    /// Bump seed for PDA
    pub bump: u8,
}

impl ProgramState {
    pub const LEN: usize = 32 + 2 + 2 + 1 + 8 + 1 + 8; // 54 bytes + discriminator
}

/// Individual ticket data
#[account]
pub struct TicketData {
    /// Mint address of the ticket NFT
    pub mint: Pubkey,
    /// Current owner of the ticket
    pub owner: Pubkey,
    /// Original owner (minter) of the ticket
    pub original_owner: Pubkey,
    /// Event identifier
    pub event_id: String,
    /// Type of ticket
    pub ticket_type: TicketType,
    /// Ticket metadata
    pub metadata: TicketMetadata,
    /// Transfer restrictions
    pub transfer_restrictions: TransferRestrictions,
    /// Content access permissions
    pub content_access: Vec<ContentAccess>,
    /// Royalty recipients
    pub royalty_recipients: Vec<RoyaltyRecipient>,
    /// Whether the ticket has been used for entry
    pub is_used: bool,
    /// Whether the ticket is currently listed on marketplace
    pub is_listed: bool,
    /// Timestamp when ticket was minted
    pub mint_timestamp: i64,
    /// Timestamp when ticket was used (if used)
    pub usage_timestamp: Option<i64>,
    /// Number of times ticket has been transferred
    pub transfer_count: u32,
    /// Bump seed for PDA
    pub bump: u8,
}

impl TicketData {
    pub const LEN: usize = 32 + 32 + 32 + 64 + 1 + 256 + 32 + 512 + 256 + 1 + 1 + 8 + 9 + 4 + 1 + 8; // ~1300 bytes + discriminator
}

/// Marketplace listing data
#[account]
pub struct MarketplaceListing {
    /// Ticket mint being listed
    pub ticket_mint: Pubkey,
    /// Seller of the ticket
    pub seller: Pubkey,
    /// Price in lamports or SPL tokens
    pub price: u64,
    /// Type of listing (fixed price, auction, etc.)
    pub listing_type: ListingType,
    /// Payment token mint (None for SOL)
    pub payment_token: Option<Pubkey>,
    /// Timestamp when listing was created
    pub created_timestamp: i64,
    /// Timestamp when listing expires (if applicable)
    pub expiry_timestamp: Option<i64>,
    /// Whether the listing is active
    pub is_active: bool,
    /// Highest bid (for auctions)
    pub highest_bid: Option<u64>,
    /// Highest bidder (for auctions)
    pub highest_bidder: Option<Pubkey>,
    /// Bump seed for PDA
    pub bump: u8,
}

impl MarketplaceListing {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 33 + 8 + 9 + 1 + 9 + 33 + 1 + 8; // ~175 bytes + discriminator
}

/// Content access verification
#[account]
pub struct ContentAccess {
    /// Content identifier
    pub content_id: String,
    /// Required access level
    pub access_level: AccessLevel,
    /// Expiration timestamp (if applicable)
    pub expiry_timestamp: Option<i64>,
    /// Whether access is currently active
    pub is_active: bool,
}

impl ContentAccess {
    pub const LEN: usize = 64 + 1 + 9 + 1; // 75 bytes
}

/// Royalty recipient information
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct RoyaltyRecipient {
    /// Recipient wallet address
    pub recipient: Pubkey,
    /// Percentage in basis points (100 = 1%)
    pub percentage_bps: u16,
    /// Role/description of recipient
    pub role: String,
}

impl RoyaltyRecipient {
    pub const LEN: usize = 32 + 2 + 32; // 66 bytes
}

/// Ticket metadata
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct TicketMetadata {
    /// Ticket name
    pub name: String,
    /// Ticket description
    pub description: String,
    /// Image URI
    pub image_uri: String,
    /// External URI for additional metadata
    pub external_uri: Option<String>,
    /// Seat information (if applicable)
    pub seat_info: Option<SeatInfo>,
    /// Event date and time
    pub event_datetime: i64,
    /// Venue information
    pub venue: String,
    /// Additional attributes
    pub attributes: Vec<Attribute>,
}

impl TicketMetadata {
    pub const LEN: usize = 32 + 256 + 128 + 129 + 65 + 8 + 64 + 256; // ~938 bytes
}

/// Seat information for assigned seating
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct SeatInfo {
    /// Section identifier
    pub section: String,
    /// Row identifier
    pub row: String,
    /// Seat number
    pub seat_number: String,
}

impl SeatInfo {
    pub const LEN: usize = 16 + 8 + 8; // 32 bytes
}

/// Attribute for additional metadata
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct Attribute {
    /// Attribute name
    pub trait_type: String,
    /// Attribute value
    pub value: String,
}

impl Attribute {
    pub const LEN: usize = 32 + 32; // 64 bytes
}

/// Transfer restrictions for tickets
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct TransferRestrictions {
    /// Type of transfers allowed
    pub transfer_type: AllowedTransferType,
    /// Maximum number of transfers allowed
    pub max_transfers: Option<u32>,
    /// Allowed recipients (if restricted)
    pub allowed_recipients: Option<Vec<Pubkey>>,
    /// Transfer fee in basis points
    pub transfer_fee_bps: u16,
    /// Whether original owner gets royalty on transfers
    pub original_owner_royalty: bool,
}

impl TransferRestrictions {
    pub const LEN: usize = 1 + 5 + 1024 + 2 + 1; // ~1033 bytes
}

/// Ticket types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum TicketType {
    /// General admission ticket
    GeneralAdmission,
    /// Reserved seating ticket
    ReservedSeating,
    /// VIP ticket with special privileges
    VIP,
    /// Backstage pass
    BackstagePass,
    /// Press/Media pass
    Press,
    /// Artist/Performer pass
    Artist,
    /// Staff/Crew pass
    Staff,
    /// Season pass (multiple events)
    SeasonPass,
    /// Custom ticket type
    Custom(String),
}

/// Access levels for content
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AccessLevel {
    /// Basic access
    Basic,
    /// Premium access
    Premium,
    /// VIP access
    VIP,
    /// Exclusive access
    Exclusive,
    /// Backstage access
    Backstage,
}

/// Types of transfers allowed
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AllowedTransferType {
    /// No transfers allowed
    NoTransfer,
    /// Only original owner can transfer
    OwnerOnly,
    /// Free transfers allowed
    FreeTransfer,
    /// Transfers allowed with restrictions
    RestrictedTransfer,
}

/// Types of marketplace listings
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ListingType {
    /// Fixed price sale
    FixedPrice,
    /// Auction with minimum bid
    Auction,
    /// Dutch auction (decreasing price)
    DutchAuction,
    /// Buy it now with best offer
    BuyNowOffer,
}

/// Transfer types
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum TransferType {
    /// Direct transfer between users
    Direct,
    /// Transfer through marketplace sale
    MarketplaceSale,
    /// Transfer as gift
    Gift,
    /// Transfer for event entry
    EventEntry,
}

/// Events emitted by the program
#[event]
pub struct TicketMinted {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub event_id: String,
    pub ticket_type: TicketType,
    pub timestamp: i64,
}

#[event]
pub struct TicketTransferred {
    pub mint: Pubkey,
    pub from: Pubkey,
    pub to: Pubkey,
    pub transfer_type: TransferType,
    pub timestamp: i64,
}

#[event]
pub struct TicketListed {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub listing_type: ListingType,
    pub timestamp: i64,
}

#[event]
pub struct TicketSold {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
    pub timestamp: i64,
}

#[event]
pub struct TicketUsed {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub event_id: String,
    pub timestamp: i64,
}

#[event]
pub struct ContentAccessGranted {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub content_id: String,
    pub access_level: AccessLevel,
    pub timestamp: i64,
}

#[event]
pub struct RoyaltyDistributed {
    pub mint: Pubkey,
    pub sale_amount: u64,
    pub recipient: Pubkey,
    pub royalty_amount: u64,
    pub timestamp: i64,
}
