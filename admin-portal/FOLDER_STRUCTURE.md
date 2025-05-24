# Admin Portal Folder Structure

This document outlines the complete folder structure for the TicketToken Admin Portal and what should be created in each directory.

## 📁 Complete Directory Structure

```
tickettoken/admin-portal/
├── public/                           # Static assets served directly
│   ├── favicon.ico                   # Browser tab icon
│   ├── favicon-16x16.png            # Small favicon
│   ├── favicon-32x32.png            # Medium favicon
│   ├── apple-touch-icon.png         # iOS home screen icon
│   ├── vite.svg                     # Vite logo
│   └── manifest.json                # PWA manifest
├── src/
│   ├── components/                   # Reusable UI components
│   │   ├── common/                   # Generic/shared components
│   │   │   ├── Button.tsx            # Button component variants
│   │   │   ├── Input.tsx             # Input field components
│   │   │   ├── Modal.tsx             # Modal/dialog components
│   │   │   ├── Table.tsx             # Table component
│   │   │   ├── Card.tsx              # Card component
│   │   │   ├── Badge.tsx             # Status badges
│   │   │   ├── LoadingSpinner.tsx    # Loading indicators
│   │   │   ├── Pagination.tsx        # Pagination controls
│   │   │   ├── SearchBar.tsx         # Search input
│   │   │   ├── Dropdown.tsx          # Dropdown menus
│   │   │   ├── DatePicker.tsx        # Date selection
│   │   │   ├── FileUpload.tsx        # File upload components
│   │   │   ├── QRCode.tsx            # QR code generator
│   │   │   ├── WalletButton.tsx      # Wallet connection button
│   │   │   └── index.ts              # Export all common components
│   │   ├── dashboard/                # Dashboard-specific components
│   │   │   ├── StatsCard.tsx         # Metric cards
│   │   │   ├── RevenueChart.tsx      # Revenue visualization
│   │   │   ├── ActivityFeed.tsx      # Recent activity list
│   │   │   ├── QuickActions.tsx      # Quick action buttons
│   │   │   ├── TopEvents.tsx         # Top performing events
│   │   │   └── index.ts              # Export dashboard components
│   │   ├── events/                   # Event management components
│   │   │   ├── EventCard.tsx         # Event display card
│   │   │   ├── EventForm.tsx         # Create/edit event form
│   │   │   ├── EventList.tsx         # Events list view
│   │   │   ├── EventFilters.tsx      # Event filtering controls
│   │   │   ├── EventStatus.tsx       # Event status indicators
│   │   │   ├── VenueSelector.tsx     # Venue selection component
│   │   │   ├── ImageUpload.tsx       # Event image upload
│   │   │   ├── TicketTypeForm.tsx    # Ticket type configuration
│   │   │   └── index.ts              # Export event components
│   │   ├── tickets/                  # Ticket management components
│   │   │   ├── TicketCard.tsx        # Ticket display card
│   │   │   ├── TicketForm.tsx        # Ticket configuration form
│   │   │   ├── TicketList.tsx        # Tickets list view
│   │   │   ├── TicketFilters.tsx     # Ticket filtering
│   │   │   ├── TicketDesigner.tsx    # NFT design interface
│   │   │   ├── TicketPreview.tsx     # Ticket visual preview
│   │   │   ├── TransferHistory.tsx   # Ownership transfer history
│   │   │   ├── VerificationPanel.tsx # Ticket verification tools
│   │   │   └── index.ts              # Export ticket components
│   │   ├── users/                    # User management components
│   │   │   ├── UserCard.tsx          # User profile card
│   │   │   ├── UserList.tsx          # Users list view
│   │   │   ├── UserFilters.tsx       # User filtering controls
│   │   │   ├── UserProfile.tsx       # Detailed user profile
│   │   │   ├── RoleSelector.tsx      # User role management
│   │   │   ├── UserStats.tsx         # User activity statistics
│   │   │   └── index.ts              # Export user components
│   │   ├── analytics/                # Analytics components
│   │   │   ├── RevenueChart.tsx      # Revenue analytics
│   │   │   ├── SalesChart.tsx        # Sales performance
│   │   │   ├── UserGrowthChart.tsx   # User growth tracking
│   │   │   ├── EventAnalytics.tsx    # Per-event analytics
│   │   │   ├── MetricsGrid.tsx       # Key metrics display
│   │   │   ├── DateRangeSelector.tsx # Date range picker
│   │   │   └── index.ts              # Export analytics components
│   │   ├── marketplace/              # Marketplace components
│   │   │   ├── ListingCard.tsx       # Marketplace listing card
│   │   │   ├── ListingList.tsx       # Listings overview
│   │   │   ├── ListingFilters.tsx    # Marketplace filtering
│   │   │   ├── BidHistory.tsx        # Auction bid history
│   │   │   ├── RoyaltySettings.tsx   # Royalty configuration
│   │   │   └── index.ts              # Export marketplace components
│   │   ├── settings/                 # Settings components
│   │   │   ├── GeneralSettings.tsx   # General platform settings
│   │   │   ├── SecuritySettings.tsx  # Security configuration
│   │   │   ├── NotificationSettings.tsx # Notification preferences
│   │   │   ├── IntegrationSettings.tsx # Third-party integrations
│   │   │   ├── BlockchainSettings.tsx # Blockchain configuration
│   │   │   └── index.ts              # Export settings components
│   │   ├── Layout.tsx                # Main layout component
│   │   ├── Sidebar.tsx               # Navigation sidebar
│   │   ├── Header.tsx                # Top header bar
│   │   ├── Navigation.tsx            # Navigation logic
│   │   ├── ProtectedRoute.tsx        # Route protection wrapper
│   │   └── ErrorBoundary.tsx         # Error boundary component
│   ├── pages/                        # Page components (route handlers)
│   │   ├── LoginPage.tsx             # Authentication page
│   │   ├── Dashboard.tsx             # Main dashboard
│   │   ├── Events.tsx                # Events management page
│   │   ├── EventDetail.tsx           # Individual event details
│   │   ├── CreateEvent.tsx           # Event creation/editing
│   │   ├── Tickets.tsx               # Tickets management page
│   │   ├── TicketDetail.tsx          # Individual ticket details
│   │   ├── Users.tsx                 # User management page
│   │   ├── UserDetail.tsx            # Individual user profile
│   │   ├── Analytics.tsx             # Analytics dashboard
│   │   ├── Marketplace.tsx           # Marketplace management
│   │   ├── Settings.tsx              # Platform settings
│   │   ├── Profile.tsx               # Admin user profile
│   │   ├── NotFound.tsx              # 404 error page
│   │   └── Unauthorized.tsx          # 403 access denied page
│   ├── hooks/                        # Custom React hooks
│   │   ├── useAuth.ts                # Authentication hook
│   │   ├── useApi.ts                 # API interaction hooks
│   │   ├── useBlockchain.ts          # Blockchain interaction hooks
│   │   ├── usePagination.ts          # Pagination logic
│   │   ├── useSearch.ts              # Search functionality
│   │   ├── useFilters.ts             # Filtering logic
│   │   ├── useLocalStorage.ts        # Local storage management
│   │   ├── useWebSocket.ts           # Real-time updates
│   │   ├── useForm.ts                # Form handling utilities
│   │   ├── useDebounce.ts            # Debouncing utility
│   │   ├── usePermissions.ts         # Permission checking
│   │   └── index.ts                  # Export all hooks
│   ├── services/                     # External service integrations
│   │   ├── apiService.ts             # Backend API service (✓ Created)
│   │   ├── blockchainService.ts      # Solana blockchain service (✓ Created)
│   │   ├── walletService.ts          # Wallet management service
│   │   ├── uploadService.ts          # File upload handling
│   │   ├── analyticsService.ts       # Analytics tracking
│   │   ├── notificationService.ts    # Push notifications
│   │   ├── websocketService.ts       # Real-time communications
│   │   └── index.ts                  # Export all services
│   ├── contexts/                     # React context providers
│   │   ├── AuthContext.tsx           # Authentication context (✓ Created)
│   │   ├── SolanaWalletContext.tsx   # Wallet context (✓ Created)
│   │   ├── ThemeContext.tsx          # UI theme management
│   │   ├── NotificationContext.tsx   # In-app notifications
│   │   ├── PermissionContext.tsx     # User permissions
│   │   └── index.ts                  # Export all contexts
│   ├── utils/                        # Utility functions
│   │   ├── constants.ts              # App-wide constants
│   │   ├── helpers.ts                # General helper functions
│   │   ├── formatters.ts             # Data formatting utilities
│   │   ├── validators.ts             # Input validation
│   │   ├── dateUtils.ts              # Date manipulation utilities
│   │   ├── cryptoUtils.ts            # Cryptocurrency formatting
│   │   ├── errorHandler.ts           # Error handling utilities
│   │   ├── localStorage.ts           # Local storage utilities
│   │   ├── permissions.ts            # Permission checking utilities
│   │   ├── api.ts                    # API request utilities
│   │   └── index.ts                  # Export all utilities
│   ├── types/                        # TypeScript type definitions
│   │   ├── index.ts                  # Main types export (✓ Created)
│   │   ├── api.ts                    # API response types
│   │   ├── blockchain.ts             # Blockchain-related types
│   │   ├── events.ts                 # Event-specific types
│   │   ├── tickets.ts                # Ticket-specific types
│   │   ├── users.ts                  # User-specific types
│   │   ├── marketplace.ts            # Marketplace types
│   │   ├── analytics.ts              # Analytics types
│   │   └── global.d.ts               # Global type declarations
│   ├── assets/                       # Static assets (images, icons, etc.)
│   │   ├── images/                   # Image files
│   │   ├── icons/                    # SVG icons
│   │   ├── fonts/                    # Custom fonts (if any)
│   │   └── logos/                    # Brand logos
│   ├── styles/                       # Additional styling files
│   │   ├── globals.css               # Global styles
│   │   ├── components.css            # Component-specific styles
│   │   └── utilities.css             # Utility classes
│   ├── App.tsx                       # Main application component (✓ Created)
│   ├── index.tsx                     # Application entry point (✓ Created)
│   └── index.css                     # Main stylesheet (✓ Created)
├── .env.example                      # Environment variables template (✓ Created)
├── .env.local                        # Local environment variables (create from .env.example)
├── .gitignore                        # Git ignore rules (✓ Created)
├── .eslintrc.json                    # ESLint configuration (✓ Created)
├── index.html                        # HTML template (✓ Created)
├── package.json                      # Dependencies and scripts (✓ Created)
├── postcss.config.js                 # PostCSS configuration (✓ Created)
├── tailwind.config.js                # Tailwind CSS configuration (✓ Created)
├── tsconfig.json                     # TypeScript configuration (✓ Created)
├── tsconfig.node.json                # TypeScript Node configuration (✓ Created)
├── vite.config.ts                    # Vite configuration (✓ Created)
└── README.md                         # Project documentation (✓ Created)
```

## 🎯 Next Steps

### Phase 1: Core Components (Priority 1)
1. **Create Layout Components**
   - `src/components/Layout.tsx`
   - `src/components/Sidebar.tsx`
   - `src/components/Header.tsx`
   - `src/components/ProtectedRoute.tsx`

2. **Create Common Components**
   - `src/components/common/Button.tsx`
   - `src/components/common/Input.tsx`
   - `src/components/common/Modal.tsx`
   - `src/components/common/Table.tsx`

3. **Create Authentication**
   - `src/pages/LoginPage.tsx`
   - Complete authentication flow

### Phase 2: Dashboard & Events (Priority 2)
1. **Dashboard Components**
   - `src/pages/Dashboard.tsx`
   - `src/components/dashboard/StatsCard.tsx`
   - `src/components/dashboard/ActivityFeed.tsx`

2. **Event Management**
   - `src/pages/Events.tsx`
   - `src/pages/CreateEvent.tsx`
   - `src/components/events/EventForm.tsx`

### Phase 3: Advanced Features (Priority 3)
1. **Ticket Management**
   - Complete ticket system components
   - NFT design interface

2. **User Management**
   - User administration interface
   - Role-based access implementation

3. **Analytics & Reporting**
   - Charts and visualizations
   - Data export functionality

### Phase 4: Polish & Optimization (Priority 4)
1. **Performance Optimization**
   - Code splitting
   - Lazy loading
   - Bundle optimization

2. **Testing & Documentation**
   - Unit tests
   - Integration tests
   - Component documentation

## 📝 Development Guidelines

### File Naming Conventions
- React components: `PascalCase.tsx`
- Hooks: `camelCase.ts` (starting with `use`)
- Utilities: `camelCase.ts`
- Types: `camelCase.ts`
- Constants: `UPPER_SNAKE_CASE`

### Component Structure
Each component should follow this structure:
```typescript
// Imports
import React from 'react';
import { ComponentProps } from '@/types';

// Types
interface Props {
  // Define props
}

// Component
export default function ComponentName({ props }: Props) {
  // Hooks
  // State
  // Effects
  // Handlers
  // Render
}
```

### Export Pattern
Use index.ts files to create clean import paths:
```typescript
// src/components/common/index.ts
export { default as Button } from './Button';
export { default as Input } from './Input';
export { default as Modal } from './Modal';
```

This structure provides a solid foundation for building a comprehensive admin portal that can scale with your needs while maintaining code organization and developer productivity.
