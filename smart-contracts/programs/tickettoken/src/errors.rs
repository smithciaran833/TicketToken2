use anchor_lang::prelude::*;

#[error_code]
pub enum TicketTokenError {
    #[msg("Program is currently paused")]
    ProgramPaused,

    #[msg("Unauthorized action")]
    Unauthorized,

    #[msg("Invalid fee percentage (must be <= 10%)")]
    InvalidFeePercentage,

    #[msg("Invalid event ID")]
    InvalidEventId,

    #[msg("Invalid metadata")]
    InvalidMetadata,

    #[msg("Too many royalty recipients (max 5)")]
    TooManyRoyaltyRecipients,

    #[msg("Invalid royalty percentage (must sum to 100%)")]
    InvalidRoyaltyPercentage,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Ticket has already been used")]
    TicketAlreadyUsed,

    #[msg("Ticket is currently listed for sale")]
    TicketCurrentlyListed,

    #[msg("Transfer not allowed for this ticket")]
    TransferNotAllowed,

    #[msg("Transfer limit exceeded")]
    TransferLimitExceeded,

    #[msg("Recipient not in allowed list")]
    RecipientNotAllowed,

    #[msg("Invalid transfer type")]
    InvalidTransferType,

    #[msg("Ticket not owned by signer")]
    NotTicketOwner,

    #[msg("Invalid verification code")]
    InvalidVerificationCode,

    #[msg("Content access not found")]
    ContentAccessNotFound,

    #[msg("Content access expired")]
    ContentAccessExpired,

    #[msg("Insufficient access level")]
    InsufficientAccessLevel,

    #[msg("Marketplace listing not found")]
    ListingNotFound,

    #[msg("Listing has expired")]
    ListingExpired,

    #[msg("Listing is not active")]
    ListingNotActive,

    #[msg("Cannot buy own listing")]
    CannotBuyOwnListing,

    #[msg("Insufficient funds for purchase")]
    InsufficientFunds,

    #[msg("Invalid listing price")]
    InvalidListingPrice,

    #[msg("Auction already has bids")]
    AuctionHasBids,

    #[msg("Bid too low")]
    BidTooLow,

    #[msg("Auction not ended")]
    AuctionNotEnded,

    #[msg("No bids on auction")]
    NoBidsOnAuction,

    #[msg("Caller is not highest bidder")]
    NotHighestBidder,

    #[msg("Invalid payment token")]
    InvalidPaymentToken,

    #[msg("Token account mismatch")]
    TokenAccountMismatch,

    #[msg("Invalid mint authority")]
    InvalidMintAuthority,

    #[msg("Invalid token amount")]
    InvalidTokenAmount,

    #[msg("Ticket mint mismatch")]
    TicketMintMismatch,

    #[msg("Invalid program authority")]
    InvalidProgramAuthority,

    #[msg("Missing required signature")]
    MissingRequiredSignature,

    #[msg("Invalid account owner")]
    InvalidAccountOwner,

    #[msg("Account not initialized")]
    AccountNotInitialized,

    #[msg("Account already initialized")]
    AccountAlreadyInitialized,

    #[msg("Invalid account size")]
    InvalidAccountSize,

    #[msg("Numerical overflow")]
    NumericalOverflow,

    #[msg("Invalid timestamp")]
    InvalidTimestamp,

    #[msg("Event has not started")]
    EventNotStarted,

    #[msg("Event has ended")]
    EventEnded,

    #[msg("Invalid seat information")]
    InvalidSeatInfo,

    #[msg("Seat already assigned")]
    SeatAlreadyAssigned,

    #[msg("Invalid venue")]
    InvalidVenue,

    #[msg("Maximum tickets per user exceeded")]
    MaxTicketsPerUserExceeded,

    #[msg("Ticket sales not active")]
    TicketSalesNotActive,

    #[msg("Presale access required")]
    PresaleAccessRequired,

    #[msg("Invalid presale code")]
    InvalidPresaleCode,

    #[msg("Whitelist access required")]
    WhitelistAccessRequired,

    #[msg("Not on whitelist")]
    NotOnWhitelist,

    #[msg("Maximum supply reached")]
    MaxSupplyReached,

    #[msg("Minimum purchase amount not met")]
    MinimumPurchaseNotMet,

    #[msg("Maximum purchase amount exceeded")]
    MaximumPurchaseExceeded,

    #[msg("Invalid discount code")]
    InvalidDiscountCode,

    #[msg("Discount code expired")]
    DiscountCodeExpired,

    #[msg("Discount code already used")]
    DiscountCodeAlreadyUsed,

    #[msg("Refund not allowed")]
    RefundNotAllowed,

    #[msg("Refund period expired")]
    RefundPeriodExpired,

    #[msg("Invalid refund amount")]
    InvalidRefundAmount,

    #[msg("Ticket not transferable")]
    TicketNotTransferable,

    #[msg("Transfer cooldown active")]
    TransferCooldownActive,

    #[msg("Invalid price range")]
    InvalidPriceRange,

    #[msg("Price too high")]
    PriceTooHigh,

    #[msg("Price too low")]
    PriceTooLow,

    #[msg("Dynamic pricing not active")]
    DynamicPricingNotActive,

    #[msg("Batch operation limit exceeded")]
    BatchOperationLimitExceeded,

    #[msg("Invalid batch size")]
    InvalidBatchSize,

    #[msg("Concurrency limit exceeded")]
    ConcurrencyLimitExceeded,

    #[msg("Rate limit exceeded")]
    RateLimitExceeded,

    #[msg("Invalid signature")]
    InvalidSignature,

    #[msg("Signature expired")]
    SignatureExpired,

    #[msg("Replay attack detected")]
    ReplayAttackDetected,

    #[msg("Invalid nonce")]
    InvalidNonce,

    #[msg("Insufficient privileges")]
    InsufficientPrivileges,

    #[msg("Feature not enabled")]
    FeatureNotEnabled,

    #[msg("Maintenance mode active")]
    MaintenanceModeActive,

    #[msg("Network congestion detected")]
    NetworkCongestion,

    #[msg("Transaction too large")]
    TransactionTooLarge,

    #[msg("Invalid cross-chain operation")]
    InvalidCrossChainOperation,

    #[msg("Bridge not available")]
    BridgeNotAvailable,

    #[msg("Cross-chain verification failed")]
    CrossChainVerificationFailed,

    #[msg("Invalid oracle data")]
    InvalidOracleData,

    #[msg("Oracle data stale")]
    OracleDataStale,

    #[msg("Price feed unavailable")]
    PriceFeedUnavailable,

    #[msg("Slippage tolerance exceeded")]
    SlippageToleranceExceeded,

    #[msg("Liquidity insufficient")]
    LiquidityInsufficient,

    #[msg("Market closed")]
    MarketClosed,

    #[msg("Trading suspended")]
    TradingSuspended,

    #[msg("Circuit breaker activated")]
    CircuitBreakerActivated,

    #[msg("Emergency shutdown active")]
    EmergencyShutdownActive,

    #[msg("Recovery mode active")]
    RecoveryModeActive,

    #[msg("Data integrity check failed")]
    DataIntegrityCheckFailed,

    #[msg("Checksum mismatch")]
    ChecksumMismatch,

    #[msg("Version mismatch")]
    VersionMismatch,

    #[msg("Incompatible program version")]
    IncompatibleProgramVersion,

    #[msg("Migration required")]
    MigrationRequired,

    #[msg("Deprecated function")]
    DeprecatedFunction,

    #[msg("Feature sunset")]
    FeatureSunset,
}
