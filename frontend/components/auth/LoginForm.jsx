import React, { useState } from 'react';
import {
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  Box,
  CircularProgress,
  InputAdornment,
  IconButton
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Login as LoginIcon
} from '@mui/icons-material';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';

export default function LoginForm() {
  const [email, setEmail] = useState('admin@wa.plest.de');
  const [password, setPassword] = useState('AdminPass123');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const { showSuccess, showError } = useNotification();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);

      if (result.success) {
        showSuccess(`Welcome back!`);
      } else {
        setError(result.error);
        showError(result.error);
      }
    } catch (error) {
      const errorMessage = 'Connection failed';
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
        p: 2
      }}
    >
      <Card
        sx={{
          maxWidth: 360,
          width: '100%',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          border: '1px solid #e0e0e0'
        }}
      >
        <CardContent sx={{ p: 4 }}>
          {/* Minimal Header */}
          <Box sx={{ textAlign: 'center', mb: 4 }}>
            <Typography
              variant="h5"
              component="h1"
              sx={{
                fontWeight: 500,
                color: '#000000',
                mb: 1
              }}
            >
              WhatsApp Manager
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: '#666666',
                fontSize: '0.75rem'
              }}
            >
              Admin Panel
            </Typography>
          </Box>

          {/* Error Alert */}
          {error && (
            <Alert
              severity="error"
              sx={{
                mb: 3,
                borderRadius: 1,
                backgroundColor: '#ffebee',
                color: '#c62828',
                border: '1px solid #ffcdd2',
                '& .MuiAlert-icon': {
                  color: '#c62828'
                }
              }}
            >
              {error}
            </Alert>
          )}

          {/* Minimal Login Form */}
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              margin="normal"
              required
              disabled={loading}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: '#ffffff',
                  borderRadius: 1,
                  '& fieldset': {
                    borderColor: '#e0e0e0',
                  },
                  '&:hover fieldset': {
                    borderColor: '#000000',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#000000',
                    borderWidth: '1px',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#666666',
                  '&.Mui-focused': {
                    color: '#000000',
                  },
                },
              }}
            />

            <TextField
              fullWidth
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              margin="normal"
              required
              disabled={loading}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: '#ffffff',
                  borderRadius: 1,
                  '& fieldset': {
                    borderColor: '#e0e0e0',
                  },
                  '&:hover fieldset': {
                    borderColor: '#000000',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#000000',
                    borderWidth: '1px',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#666666',
                  '&.Mui-focused': {
                    color: '#000000',
                  },
                },
              }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowPassword(!showPassword)}
                      edge="end"
                      disabled={loading}
                      sx={{ color: '#666666' }}
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <LoginIcon />}
              sx={{
                mt: 3,
                py: 1.2,
                backgroundColor: '#000000',
                color: '#ffffff',
                borderRadius: 1,
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: '#333333',
                  boxShadow: 'none',
                },
                '&:disabled': {
                  backgroundColor: '#cccccc',
                  color: '#ffffff',
                },
              }}
            >
              {loading ? 'Signing In...' : 'Sign In'}
            </Button>
          </form>

          {/* Minimal Footer */}
          <Box sx={{ mt: 3, textAlign: 'center' }}>
            <Typography
              variant="caption"
              sx={{
                color: '#999999',
                fontSize: '0.7rem'
              }}
            >
              wa.plest.de
            </Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}