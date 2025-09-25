import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, loading, isAuthenticated, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated()) {
        router.push('/login');
        return;
      }

      if (requireAdmin && !isAdmin()) {
        router.push('/dashboard'); // Redirect to dashboard if not admin
        return;
      }
    }
  }, [user, loading, router, requireAdmin]);

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 2
        }}
      >
        <CircularProgress size={40} />
        <Typography variant="body1" color="text.secondary">
          Loading WhatsApp Manager...
        </Typography>
      </Box>
    );
  }

  // Show access denied if not authenticated
  if (!isAuthenticated()) {
    return null; // Will redirect to login
  }

  // Show access denied if admin required but user is not admin
  if (requireAdmin && !isAdmin()) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: 2
        }}
      >
        <Typography variant="h5" color="error">
          Access Denied
        </Typography>
        <Typography variant="body1" color="text.secondary">
          This area requires administrator privileges.
        </Typography>
      </Box>
    );
  }

  // Render protected content
  return children;
}