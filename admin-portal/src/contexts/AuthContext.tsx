import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { User, UserRole } from '@/types';
import { apiService } from '@/services/apiService';
import toast from 'react-hot-toast';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  loginWithWallet: (publicKey: string, signature: string) => Promise<boolean>;
  logout: () => void;
  hasRole: (role: UserRole) => boolean;
  hasPermission: (permission: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for existing auth token on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        apiService.setAuthToken(token);
        const response = await apiService.getCurrentUser();
        if (response.success && response.data) {
          setUser(response.data);
        } else {
          localStorage.removeItem('auth_token');
          apiService.setAuthToken(null);
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      localStorage.removeItem('auth_token');
      apiService.setAuthToken(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    try {
      setLoading(true);
      const response = await apiService.login({ email, password });
      
      if (response.success && response.data) {
        const { token, user: userData } = response.data;
        localStorage.setItem('auth_token', token);
        apiService.setAuthToken(token);
        setUser(userData);
        toast.success('Login successful!');
        return true;
      } else {
        toast.error(response.error || 'Login failed');
        return false;
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Login failed. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const loginWithWallet = async (publicKey: string, signature: string): Promise<boolean> => {
    try {
      setLoading(true);
      const response = await apiService.loginWithWallet({ publicKey, signature });
      
      if (response.success && response.data) {
        const { token, user: userData } = response.data;
        localStorage.setItem('auth_token', token);
        apiService.setAuthToken(token);
        setUser(userData);
        toast.success('Wallet login successful!');
        return true;
      } else {
        toast.error(response.error || 'Wallet login failed');
        return false;
      }
    } catch (error) {
      console.error('Wallet login error:', error);
      toast.error('Wallet login failed. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('auth_token');
    apiService.setAuthToken(null);
    setUser(null);
    toast.success('Logged out successfully');
  };

  const hasRole = (role: UserRole): boolean => {
    if (!user) return false;
    
    // Admin has access to everything
    if (user.role === 'admin') return true;
    
    // Check specific role
    return user.role === role;
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    
    // Define role-based permissions
    const rolePermissions: Record<UserRole, string[]> = {
      admin: ['*'], // Admin has all permissions
      venue_admin: [
        'events.create',
        'events.edit',
        'events.delete',
        'events.view',
        'tickets.create',
        'tickets.edit',
        'tickets.view',
        'analytics.view',
        'users.view',
      ],
      artist: [
        'events.create',
        'events.edit',
        'events.view',
        'tickets.create',
        'tickets.edit',
        'tickets.view',
        'analytics.view',
      ],
      user: [
        'events.view',
        'tickets.view',
      ],
    };

    const userPermissions = rolePermissions[user.role] || [];
    
    // Admin has all permissions
    if (userPermissions.includes('*')) return true;
    
    // Check specific permission
    return userPermissions.includes(permission);
  };

  const refreshUser = async () => {
    try {
      const response = await apiService.getCurrentUser();
      if (response.success && response.data) {
        setUser(response.data);
      }
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  };

  const contextValue: AuthContextType = {
    user,
    loading,
    login,
    loginWithWallet,
    logout,
    hasRole,
    hasPermission,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
