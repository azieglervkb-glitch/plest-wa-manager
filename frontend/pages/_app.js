import React from 'react';
import Head from 'next/head';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { AuthProvider } from '../contexts/AuthContext';
import { NotificationProvider } from '../contexts/NotificationContext';

// Minimal Clean Theme
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#000000', // Black for minimal look
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#666666', // Gray
    },
    success: {
      main: '#00C851', // Clean green
    },
    warning: {
      main: '#ff9800', // Clean orange
    },
    error: {
      main: '#ff1744', // Clean red
    },
    background: {
      default: '#ffffff', // Pure white background
      paper: '#ffffff',
    },
    text: {
      primary: '#000000',
      secondary: '#666666',
    },
  },
  typography: {
    fontFamily: '"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: { fontWeight: 600, fontSize: '2.5rem' },
    h2: { fontWeight: 600, fontSize: '2rem' },
    h3: { fontWeight: 600, fontSize: '1.75rem' },
    h4: { fontWeight: 500, fontSize: '1.5rem' },
    h5: { fontWeight: 500, fontSize: '1.25rem' },
    h6: { fontWeight: 500, fontSize: '1rem' },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.75rem' },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          borderRadius: 4,
          border: '1px solid #f0f0f0',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 4,
          boxShadow: 'none',
          '&:hover': {
            boxShadow: 'none',
          },
        },
        contained: {
          backgroundColor: '#000000',
          color: '#ffffff',
          '&:hover': {
            backgroundColor: '#333333',
          },
        },
        outlined: {
          borderColor: '#e0e0e0',
          color: '#000000',
          '&:hover': {
            borderColor: '#000000',
            backgroundColor: 'rgba(0,0,0,0.04)',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          color: '#000000',
          boxShadow: '0 1px 0 rgba(0,0,0,0.1)',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#ffffff',
          borderRight: '1px solid #f0f0f0',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 4,
        },
        outlined: {
          backgroundColor: '#ffffff',
        },
      },
    },
  },
});

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>WhatsApp Manager - Admin Panel</title>
        <meta name="description" content="WhatsApp Multi-Instance Manager" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AuthProvider>
          <NotificationProvider>
            <Component {...pageProps} />
          </NotificationProvider>
        </AuthProvider>
      </ThemeProvider>
    </>
  );
}