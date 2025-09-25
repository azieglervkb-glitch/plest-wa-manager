import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  Alert,
  Chip
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import QRCode from 'qrcode.react';
import { useNotification } from '../../contexts/NotificationContext';
import apiClient from '../../services/apiClient';

export default function QRCodeDialog({ instance, open, onClose, onStatusChange }) {
  const [qrCode, setQrCode] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(instance?.status || 'unknown');

  const { showSuccess, showError, showInfo } = useNotification();

  useEffect(() => {
    if (open && instance) {
      setStatus(instance.status);
      fetchQRCode();

      // Auto-refresh QR code every 30 seconds
      const interval = setInterval(() => {
        if (status === 'qr_pending' || status === 'connecting') {
          fetchQRCode();
        }
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [open, instance]);

  const fetchQRCode = async () => {
    if (!instance) return;

    setLoading(true);
    setError('');

    try {
      console.log('Fetching QR code for instance:', instance.instanceId);

      const response = await apiClient.getInstanceQR(instance.instanceId);

      console.log('QR Code API response:', response);

      if (response.qrCode) {
        setQrCode(response.qrCode);
        setStatus(response.status);

        if (onStatusChange) {
          onStatusChange(instance.instanceId, response.status);
        }

        showInfo('QR code loaded successfully');
      } else {
        setError('No QR code available. Try starting the instance first.');
        console.log('No QR code in response:', response);
      }
    } catch (error) {
      console.error('Failed to fetch QR code:', error);
      setError(`Failed to load QR code: ${error.message}`);
      showError(`QR Code Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getStatusInfo = (status) => {
    switch (status) {
      case 'qr_pending':
        return {
          color: '#2196f3',
          text: 'Waiting for QR scan',
          description: 'Open WhatsApp on your phone and scan the QR code'
        };
      case 'connecting':
        return {
          color: '#ff9800',
          text: 'Connecting...',
          description: 'Establishing connection to WhatsApp'
        };
      case 'authenticated':
        return {
          color: '#4caf50',
          text: 'Authenticated',
          description: 'Successfully connected to WhatsApp'
        };
      case 'ready':
        return {
          color: '#00C851',
          text: 'Ready',
          description: 'WhatsApp instance is ready for use'
        };
      case 'error':
        return {
          color: '#ff1744',
          text: 'Error',
          description: 'Connection failed. Try restarting the instance.'
        };
      default:
        return {
          color: '#666666',
          text: 'Unknown',
          description: 'Status unknown'
        };
    }
  };

  const statusInfo = getStatusInfo(status);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        }
      }}
    >
      <DialogTitle sx={{ textAlign: 'center', pb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 500, mb: 1 }}>
          WhatsApp Authentication
        </Typography>
        <Typography variant="body2" sx={{ color: '#666666' }}>
          {instance?.name}
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ textAlign: 'center', py: 2 }}>
        {/* Status Indicator */}
        <Box sx={{ mb: 3 }}>
          <Chip
            label={statusInfo.text}
            sx={{
              backgroundColor: statusInfo.color,
              color: '#ffffff',
              fontWeight: 500,
              borderRadius: 1
            }}
          />
          <Typography
            variant="body2"
            sx={{
              color: '#666666',
              fontSize: '0.875rem',
              mt: 1
            }}
          >
            {statusInfo.description}
          </Typography>
        </Box>

        {/* Error Alert */}
        {error && (
          <Alert
            severity="error"
            sx={{
              mb: 3,
              borderRadius: 1,
              textAlign: 'left'
            }}
          >
            {error}
          </Alert>
        )}

        {/* QR Code Display */}
        <Box sx={{ mb: 3 }}>
          {loading ? (
            <Box
              sx={{
                width: 256,
                height: 256,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f9f9f9',
                borderRadius: 1,
                mx: 'auto'
              }}
            >
              <CircularProgress />
            </Box>
          ) : qrCode ? (
            <Box
              sx={{
                p: 2,
                backgroundColor: '#ffffff',
                borderRadius: 1,
                border: '1px solid #e0e0e0',
                display: 'inline-block'
              }}
            >
              <QRCode
                value={qrCode}
                size={256}
                level="M"
                includeMargin={false}
              />
            </Box>
          ) : (
            <Box
              sx={{
                width: 256,
                height: 256,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f9f9f9',
                borderRadius: 1,
                mx: 'auto',
                flexDirection: 'column'
              }}
            >
              <ErrorIcon sx={{ fontSize: 40, color: '#ff1744', mb: 1 }} />
              <Typography variant="body2" color="text.secondary">
                No QR code available
              </Typography>
            </Box>
          )}
        </Box>

        {/* Instructions */}
        {qrCode && (
          <Box
            sx={{
              textAlign: 'left',
              backgroundColor: '#f9f9f9',
              p: 2,
              borderRadius: 1,
              border: '1px solid #f0f0f0'
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>
              How to connect:
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
              1. Open WhatsApp on your phone
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
              2. Go to Settings → Linked Devices
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.75rem', mb: 0.5 }}>
              3. Tap "Link a Device"
            </Typography>
            <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
              4. Scan this QR code
            </Typography>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button
          onClick={onClose}
          sx={{ color: '#666666' }}
        >
          Close
        </Button>
        <Button
          onClick={fetchQRCode}
          disabled={loading}
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
          sx={{
            borderColor: '#e0e0e0',
            color: '#000000',
            '&:hover': {
              borderColor: '#000000',
              backgroundColor: 'rgba(0,0,0,0.04)',
            }
          }}
        >
          {loading ? 'Loading...' : 'Refresh QR'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}