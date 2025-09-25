import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import apiClient from '../services/apiClient';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);
  const router = useRouter();

  useEffect(() => {
    // Check for existing token on mount
    const savedToken = localStorage.getItem('jwt-token');
    if (savedToken) {
      setToken(savedToken);
      apiClient.setToken(savedToken);
      verifyToken(savedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const verifyToken = async (token) => {
    try {
      const response = await apiClient.get('/auth/me');
      if (response.user) {
        setUser(response.user);
      } else {
        logout();
      }
    } catch (error) {
      console.log('Token verification failed:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      setLoading(true);
      const response = await apiClient.post('/auth/login', { email, password });

      if (response.tokens?.accessToken) {
        const newToken = response.tokens.accessToken;
        setToken(newToken);
        setUser(response.user);

        localStorage.setItem('jwt-token', newToken);
        apiClient.setToken(newToken);

        // Redirect to dashboard
        router.push('/dashboard');

        return { success: true, user: response.user };
      } else {
        return { success: false, error: response.error || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Connection failed' };
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('jwt-token');
    apiClient.setToken(null);
    router.push('/login');
  };

  const isAuthenticated = () => {
    return !!user && !!token;
  };

  const isAdmin = () => {
    return user && ['admin', 'superadmin'].includes(user.role);
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    isAuthenticated,
    isAdmin,
    verifyToken
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};