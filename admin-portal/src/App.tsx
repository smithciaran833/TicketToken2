import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Toaster } from 'react-hot-toast';

// Context Providers
import { SolanaWalletProvider } from '@/contexts/SolanaWalletContext';
import { AuthProvider } from '@/contexts/AuthContext';

// Components and Pages
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import Dashboard from '@/pages/Dashboard';
import Events from '@/pages/Events';
import EventDetail from '@/pages/EventDetail';
import CreateEvent from '@/pages/CreateEvent';
import Tickets from '@/pages/Tickets';
import TicketDetail from '@/pages/TicketDetail';
import Users from '@/pages/Users';
import UserDetail from '@/pages/UserDetail';
import Analytics from '@/pages/Analytics';
import Marketplace from '@/pages/Marketplace';
import Settings from '@/pages/Settings';
import Profile from '@/pages/Profile';

// Protected Route Component
import ProtectedRoute from '@/components/ProtectedRoute';

// Styles
import './index.css';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SolanaWalletProvider>
        <AuthProvider>
          <Router>
            <div className="min-h-screen bg-gray-50">
              <Routes>
                {/* Public route */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* Protected routes with layout */}
                <Route path="/" element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }>
                  {/* Dashboard */}
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  
                  {/* Events */}
                  <Route path="events" element={<Events />} />
                  <Route path="events/create" element={<CreateEvent />} />
                  <Route path="events/:id" element={<EventDetail />} />
                  <Route path="events/:id/edit" element={<CreateEvent />} />
                  
                  {/* Tickets */}
                  <Route path="tickets" element={<Tickets />} />
                  <Route path="tickets/:id" element={<TicketDetail />} />
                  
                  {/* Users */}
                  <Route path="users" element={<Users />} />
                  <Route path="users/:id" element={<UserDetail />} />
                  
                  {/* Marketplace */}
                  <Route path="marketplace" element={<Marketplace />} />
                  
                  {/* Analytics */}
                  <Route path="analytics" element={<Analytics />} />
                  
                  {/* Settings */}
                  <Route path="settings" element={<Settings />} />
                  
                  {/* Profile */}
                  <Route path="profile" element={<Profile />} />
                </Route>
                
                {/* Catch all route */}
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
              
              {/* Toast notifications */}
              <Toaster
                position="top-right"
                toastOptions={{
                  duration: 4000,
                  style: {
                    background: '#363636',
                    color: '#fff',
                  },
                  success: {
                    duration: 3000,
                    iconTheme: {
                      primary: '#22c55e',
                      secondary: '#fff',
                    },
                  },
                  error: {
                    duration: 5000,
                    iconTheme: {
                      primary: '#ef4444',
                      secondary: '#fff',
                    },
                  },
                }}
              />
            </div>
          </Router>
        </AuthProvider>
      </SolanaWalletProvider>
    </QueryClientProvider>
  );
}

export default App;
