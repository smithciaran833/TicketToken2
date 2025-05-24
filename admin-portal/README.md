# TicketToken Admin Portal

A comprehensive admin dashboard for managing the TicketToken NFT ticketing platform built on Solana blockchain.

## 🚀 Features

- **Dashboard Overview**: Real-time analytics and key metrics
- **Event Management**: Create, edit, and manage events with complete lifecycle control
- **Ticket Management**: Configure ticket types, pricing, and NFT properties
- **User Management**: View and manage platform users with role-based access
- **Marketplace Administration**: Monitor and moderate secondary ticket sales
- **Analytics & Reporting**: Detailed insights into sales, revenue, and user activity
- **Blockchain Integration**: Full Solana wallet connection and smart contract interaction
- **Role-Based Access Control**: Admin, venue admin, and artist permission levels

## 🛠 Technology Stack

- **Frontend**: React 18 with TypeScript
- **Styling**: Tailwind CSS with custom components
- **State Management**: React Query for server state, React Context for app state
- **Routing**: React Router v6
- **Blockchain**: Solana Web3.js, Wallet Adapter
- **Charts**: Chart.js with React wrapper
- **Forms**: React Hook Form with validation
- **Notifications**: React Hot Toast
- **Build Tool**: Vite

## 📋 Prerequisites

- Node.js 18+ and npm/yarn
- Access to TicketToken backend API
- Solana wallet (Phantom, Solflare) for testing

## 🔧 Installation

1. **Clone the repository**
   ```bash
   cd tickettoken/admin-portal
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Environment Configuration**
   
   Create a `.env.local` file in the admin-portal directory:
   ```env
   # API Configuration
   VITE_API_BASE_URL=http://localhost:3000/api
   
   # Solana Configuration
   VITE_SOLANA_NETWORK=devnet
   VITE_SOLANA_DEVNET_RPC=https://api.devnet.solana.com
   VITE_SOLANA_MAINNET_RPC=https://api.mainnet-beta.solana.com
   
   # Program IDs (Replace with your actual program IDs)
   VITE_TICKET_TOKEN_PROGRAM_ID=YourProgramIdHere
   
   # Feature Flags
   VITE_ENABLE_MARKETPLACE=true
   VITE_ENABLE_ANALYTICS=true
   ```

4. **Start the development server**
   ```bash
   npm run dev
   # or
   yarn dev
   ```

5. **Open your browser**
   
   Navigate to `http://localhost:3001`

## 🏗 Project Structure

```
admin-portal/
├── public/                 # Static assets
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── common/         # Generic components (buttons, modals, etc.)
│   │   ├── dashboard/      # Dashboard-specific components
│   │   ├── events/         # Event management components
│   │   ├── tickets/        # Ticket management components
│   │   ├── users/          # User management components
│   │   └── Layout.tsx      # Main layout wrapper
│   ├── pages/              # Page components (one per route)
│   ├── hooks/              # Custom React hooks
│   ├── contexts/           # React context providers
│   ├── services/           # API and blockchain services
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Utility functions
│   ├── App.tsx             # Main app component
│   ├── index.tsx           # Entry point
│   └── index.css           # Global styles
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 🔐 Authentication & Authorization

The admin portal implements a multi-tier authentication system:

1. **Email/Password Authentication**: Traditional login for admin users
2. **Wallet Authentication**: Solana wallet-based login for blockchain integration
3. **Role-Based Access Control**:
   - **Admin**: Full platform access
   - **Venue Admin**: Event and ticket management for specific venues
   - **Artist**: Event creation and management for own events
   - **User**: Read-only access to basic information

## 📱 Key Screens & Features

### Dashboard
- Revenue and sales metrics
- Recent activity feed
- Top-performing events
- User growth analytics
- Quick actions panel

### Event Management
- Create and edit events with rich forms
- Upload and manage event images
- Configure ticket types and pricing
- Set sale dates and limitations
- Publish/unpublish events
- Event analytics and attendee management

### Ticket Management
- View all tickets across events
- Configure NFT metadata and visual designs
- Manage ticket transfers and ownership
- Ticket verification and validation
- Generate QR codes for entry

### User Management
- User search and filtering
- View user profiles and activity
- Manage user roles and permissions
- User analytics and behavior insights

### Marketplace
- Monitor secondary sales
- Moderate listings
- Configure royalty fees
- Handle disputes and refunds

### Analytics
- Revenue tracking and projections
- Sales performance by event/venue
- User engagement metrics
- Blockchain transaction monitoring

## 🔧 Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript compiler check

### Code Standards

- TypeScript for all new code
- ESLint and Prettier for code formatting
- Component-first architecture
- Tailwind CSS for styling
- Comprehensive error handling
- Responsive design (mobile-first)

### Testing Strategy

The admin portal should implement:

1. **Unit Tests**: Jest + React Testing Library
2. **Integration Tests**: API and blockchain interactions
3. **E2E Tests**: Cypress or Playwright
4. **Performance Tests**: Lighthouse CI

## 🚀 Deployment

### Production Build

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

### Environment-Specific Deployments

- **Development**: Auto-deploy from `dev` branch
- **Staging**: Auto-deploy from `staging` branch  
- **Production**: Manual deploy from `main` branch

### Hosting Options

- **Vercel**: Recommended for easy setup
- **Netlify**: Alternative with good performance
- **AWS S3 + CloudFront**: For enterprise deployments
- **Docker**: Containerized deployment option

## 🔒 Security Considerations

- All API calls authenticated with JWT tokens
- Wallet connections handled securely through adapters
- Environment variables for sensitive configuration
- CSP headers implemented
- Regular dependency updates
- Input validation and sanitization

## 🐛 Troubleshooting

### Common Issues

1. **Wallet Connection Fails**
   - Ensure wallet extension is installed and unlocked
   - Check network configuration (devnet/mainnet)
   - Verify program IDs in environment

2. **API Calls Fail**
   - Check backend server is running
   - Verify API base URL in environment
   - Ensure authentication token is valid

3. **Build Errors**
   - Clear node_modules and reinstall
   - Check TypeScript configuration
   - Verify all dependencies are compatible

### Debug Mode

Enable debug logging by setting:
```env
VITE_DEBUG=true
```

## 📈 Performance

- Code splitting implemented
- Lazy loading for routes
- Image optimization
- Bundle analysis available
- Performance monitoring integrated

## 🤝 Contributing

1. Follow existing code patterns
2. Add TypeScript types for new features
3. Include tests for new functionality
4. Update documentation as needed
5. Use semantic commit messages

## 📄 License

This project is part of the TicketToken platform and follows the main project's licensing terms.

## 🔗 Related Links

- [Main TicketToken Repository](../../README.md)
- [Backend API Documentation](../backend/README.md)
- [Smart Contracts Documentation](../contracts/README.md)
- [Mobile Apps](../android/README.md)

---

For support or questions, please refer to the main project documentation or contact the development team.
