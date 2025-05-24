export interface User {
  id: string;
  publicKey: string;
  email?: string;
  username: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastActive: Date;
  profile?: UserProfile;
}

export interface UserProfile {
  displayName?: string;
  bio?: string;
  avatar?: string;
  website?: string;
  socialLinks?: {
    twitter?: string;
    discord?: string;
    instagram?: string;
  };
}

export enum UserRole {
  ADMIN = 'admin',
  VENUE_OWNER = 'venue_owner',
  ARTIST = 'artist',
  USER = 'user',
}

export interface Event {
  id: string;
  publicKey: string;
  title: string;
  description: string;
  imageUrl?: string;
  bannerUrl?: string;
  startDate: Date;
  endDate?: Date;
  venue: Venue;
  organizer: User;
  category: EventCategory;
  status: EventStatus;
  ticketTypes: TicketType[];
  settings: EventSettings;
  analytics?: EventAnalytics;
  createdAt: Date;
  updatedAt: Date;
}

export interface Venue {
  id: string;
  name: string;
  address: Address;
  capacity: number;
  description?: string;
  amenities?: string[];
  images?: string[];
  owner: User;
}

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export enum EventCategory {
  MUSIC = 'music',
  SPORTS = 'sports',
  TECHNOLOGY = 'technology',
  BUSINESS = 'business',
  ARTS = 'arts',
  EDUCATION = 'education',
  OTHER = 'other',
}

export enum EventStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  LIVE = 'live',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
}

export interface EventSettings {
  isPublic: boolean;
  allowResale: boolean;
  maxTicketsPerUser: number;
  saleStartDate?: Date;
  saleEndDate?: Date;
  transferRestrictions?: TransferRestrictions;
  governanceEnabled: boolean;
}

export interface TransferRestrictions {
  allowedUntil?: Date;
  requiresApproval: boolean;
  transferFee?: number;
}

export interface TicketType {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  totalSupply: number;
  soldCount: number;
  availableCount: number;
  saleStartDate?: Date;
  saleEndDate?: Date;
  transferable: boolean;
  refundable: boolean;
  metadata: TicketMetadata;
  perks?: string[];
}

export interface TicketMetadata {
  image?: string;
  attributes?: TicketAttribute[];
  rarity?: TicketRarity;
}

export interface TicketAttribute {
  trait_type: string;
  value: string | number;
}

export enum TicketRarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary',
}

export interface Ticket {
  id: string;
  tokenId: string;
  mintAddress: string;
  eventId: string;
  ticketTypeId: string;
  ownerId: string;
  status: TicketStatus;
  purchaseDate: Date;
  usedDate?: Date;
  transferHistory: Transfer[];
  metadata: TicketMetadata;
}

export enum TicketStatus {
  VALID = 'valid',
  USED = 'used',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  TRANSFERRED = 'transferred',
}

export interface Transfer {
  id: string;
  ticketId: string;
  fromUser: string;
  toUser: string;
  transferDate: Date;
  transferType: TransferType;
  price?: number;
  transactionSignature: string;
}

export enum TransferType {
  PURCHASE = 'purchase',
  GIFT = 'gift',
  RESALE = 'resale',
  REFUND = 'refund',
}

export interface EventAnalytics {
  totalRevenue: number;
  ticketsSold: number;
  totalAttendees: number;
  demographics: Demographics;
  salesByDate: SalesData[];
  topTicketTypes: TicketTypeSales[];
  secondaryMarketActivity: SecondaryMarketData;
}

export interface Demographics {
  ageGroups: { [key: string]: number };
  locations: { [key: string]: number };
}

export interface SalesData {
  date: Date;
  revenue: number;
  ticketsSold: number;
}

export interface TicketTypeSales {
  ticketTypeId: string;
  name: string;
  soldCount: number;
  revenue: number;
}

export interface SecondaryMarketData {
  totalVolume: number;
  totalSales: number;
  averagePrice: number;
  priceHistory: PricePoint[];
}

export interface PricePoint {
  date: Date;
  price: number;
}

export interface MarketplaceListing {
  id: string;
  ticketId: string;
  sellerId: string;
  price: number;
  currency: string;
  listingType: ListingType;
  status: ListingStatus;
  createdAt: Date;
  expiresAt?: Date;
  auctionData?: AuctionData;
}

export enum ListingType {
  FIXED_PRICE = 'fixed_price',
  AUCTION = 'auction',
}

export enum ListingStatus {
  ACTIVE = 'active',
  SOLD = 'sold',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export interface AuctionData {
  startingPrice: number;
  currentHighestBid?: number;
  highestBidder?: string;
  bidHistory: Bid[];
  endTime: Date;
}

export interface Bid {
  id: string;
  bidderId: string;
  amount: number;
  timestamp: Date;
}

export interface GovernanceProposal {
  id: string;
  proposerId: string;
  eventId?: string;
  title: string;
  description: string;
  proposalType: ProposalType;
  status: ProposalStatus;
  votingStartDate: Date;
  votingEndDate: Date;
  executionDate?: Date;
  votes: Vote[];
  results?: ProposalResults;
}

export enum ProposalType {
  EVENT_CHANGE = 'event_change',
  VENUE_CHANGE = 'venue_change',
  REFUND_POLICY = 'refund_policy',
  GENERAL = 'general',
}

export enum ProposalStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  PASSED = 'passed',
  REJECTED = 'rejected',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
}

export interface Vote {
  id: string;
  voterId: string;
  voteType: VoteType;
  weight: number;
  timestamp: Date;
}

export enum VoteType {
  YES = 'yes',
  NO = 'no',
  ABSTAIN = 'abstain',
}

export interface ProposalResults {
  totalVotes: number;
  yesVotes: number;
  noVotes: number;
  abstainVotes: number;
  participationRate: number;
  passed: boolean;
}

export interface StakePool {
  id: string;
  name: string;
  description?: string;
  poolType: PoolType;
  tokenMint: string;
  rewardTokenMint: string;
  totalStaked: number;
  totalRewards: number;
  apy: number;
  minStakeAmount: number;
  maxStakeAmount: number;
  stakersCount: number;
  isActive: boolean;
  createdAt: Date;
}

export enum PoolType {
  GENERAL = 'general',
  EVENT_SPECIFIC = 'event_specific',
  VIP = 'vip',
  LIQUIDITY_PROVIDER = 'liquidity_provider',
}

export interface UserStake {
  id: string;
  userId: string;
  poolId: string;
  stakedAmount: number;
  earnedRewards: number;
  stakingTier: StakingTier;
  stakeDate: Date;
  lastClaimDate?: Date;
  unstakeRequest?: UnstakeRequest;
}

export enum StakingTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
  DIAMOND = 'diamond',
}

export interface UnstakeRequest {
  amount: number;
  requestDate: Date;
  availableDate: Date;
  status: UnstakeStatus;
}

export enum UnstakeStatus {
  PENDING = 'pending',
  AVAILABLE = 'available',
  WITHDRAWN = 'withdrawn',
}

export interface DashboardStats {
  totalRevenue: number;
  totalTicketsSold: number;
  activeEvents: number;
  totalUsers: number;
  revenueGrowth: number;
  ticketSalesGrowth: number;
  userGrowth: number;
  topEvents: Event[];
  recentActivity: Activity[];
}

export interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  timestamp: Date;
  metadata?: any;
}

export enum ActivityType {
  EVENT_CREATED = 'event_created',
  TICKET_PURCHASED = 'ticket_purchased',
  TICKET_TRANSFERRED = 'ticket_transferred',
  USER_REGISTERED = 'user_registered',
  PROPOSAL_CREATED = 'proposal_created',
  STAKE_CREATED = 'stake_created',
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FilterParams {
  status?: string;
  category?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}
