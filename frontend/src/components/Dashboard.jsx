import React, { useState, useEffect } from 'react';
import {
  Grid,
  Paper,
  Typography,
  Box,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  Alert,
  Fab,
  Tooltip
} from '@mui/material';
import {
  Add as AddIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Restart as RestartIcon,
  Delete as DeleteIcon,
  QrCode as QrCodeIcon,
  Message as MessageIcon,
  Analytics as AnalyticsIcon,
  Settings as SettingsIcon,
  WhatsApp as WhatsAppIcon
} from '@mui/icons-material';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import toast from 'react-hot-toast';
import QRCode from 'qrcode.react';

import { instancesApi } from '../services/api';
import InstanceCard from './InstanceCard';
import CreateInstanceDialog from './CreateInstanceDialog';
import QRCodeDialog from './QRCodeDialog';
import MessageDialog from './MessageDialog';

const Dashboard = () => {
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [qrCode, setQrCode] = useState('');

  const queryClient = useQueryClient();

  // Instanzen abrufen
  const { data: instances, isLoading, error } = useQuery('instances', instancesApi.getAll, {
    refetchInterval: 5000, // Alle 5 Sekunden aktualisieren
  });

  // Dashboard-Statistiken abrufen
  const { data: dashboardStats } = useQuery('dashboardStats', instancesApi.getDashboardStats, {
    refetchInterval: 10000,
  });

  // Instanz-Aktionen
  const startMutation = useMutation(instancesApi.start, {
    onSuccess: (data, instanceId) => {
      toast.success('Instanz wird gestartet');
      queryClient.invalidateQueries('instances');
    },
    onError: (error) => {
      toast.error('Fehler beim Starten der Instanz');
    }
  });

  const stopMutation = useMutation(instancesApi.stop, {
    onSuccess: () => {
      toast.success('Instanz gestoppt');
      queryClient.invalidateQueries('instances');
    },
    onError: () => {
      toast.error('Fehler beim Stoppen der Instanz');
    }
  });

  const deleteMutation = useMutation(instancesApi.delete, {
    onSuccess: () => {
      toast.success('Instanz gelöscht');
      queryClient.invalidateQueries('instances');
    },
    onError: () => {
      toast.error('Fehler beim Löschen der Instanz');
    }
  });

  const restartMutation = useMutation(instancesApi.restart, {
    onSuccess: () => {
      toast.success('Instanz wird neugestartet');
      queryClient.invalidateQueries('instances');
    },
    onError: () => {
      toast.error('Fehler beim Neustarten der Instanz');
    }
  });

  // QR-Code abrufen
  const fetchQRCode = async (instanceId) => {
    try {
      const response = await instancesApi.getQRCode(instanceId);
      setQrCode(response.qrCode);
      setQrDialogOpen(true);
    } catch (error) {
      toast.error('Fehler beim Abrufen des QR-Codes');
    }
  };

  // Status-Farben
  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'success';
      case 'connecting': case 'qr_pending': return 'warning';
      case 'disconnected': case 'error': return 'error';
      case 'stopped': return 'default';
      default: return 'default';
    }
  };

  // Status-Text
  const getStatusText = (status) => {
    switch (status) {
      case 'ready': return 'Verbunden';
      case 'connecting': return 'Verbinde...';
      case 'qr_pending': return 'QR-Code scannen';
      case 'authenticated': return 'Authentifiziert';
      case 'disconnected': return 'Getrennt';
      case 'error': return 'Fehler';
      case 'stopped': return 'Gestoppt';
      default: return status;
    }
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <Typography>Lade Instanzen...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        Fehler beim Laden der Instanzen: {error.message}
      </Alert>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          WhatsApp Instance Manager
        </Typography>
        <Typography variant="subtitle1" color="textSecondary">
          Verwalten Sie Ihre WhatsApp-Instanzen zentral über das Dashboard
        </Typography>
      </Box>

      {/* Statistiken */}
      {dashboardStats && (
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <WhatsAppIcon color="primary" sx={{ mr: 2 }} />
                  <Box>
                    <Typography color="textSecondary" gutterBottom>
                      Aktive Instanzen
                    </Typography>
                    <Typography variant="h4">
                      {dashboardStats.activeInstances}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <MessageIcon color="success" sx={{ mr: 2 }} />
                  <Box>
                    <Typography color="textSecondary" gutterBottom>
                      Nachrichten heute
                    </Typography>
                    <Typography variant="h4">
                      {dashboardStats.todayMessages}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <AnalyticsIcon color="warning" sx={{ mr: 2 }} />
                  <Box>
                    <Typography color="textSecondary" gutterBottom>
                      Erfolgsrate
                    </Typography>
                    <Typography variant="h4">
                      {dashboardStats.successRate}%
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center">
                  <SettingsIcon color="info" sx={{ mr: 2 }} />
                  <Box>
                    <Typography color="textSecondary" gutterBottom>
                      Uptime Durchschnitt
                    </Typography>
                    <Typography variant="h4">
                      {dashboardStats.avgUptime}h
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Nachrichten-Verlauf Chart */}
      {dashboardStats?.messageHistory && (
        <Paper sx={{ p: 3, mb: 4 }}>
          <Typography variant="h6" gutterBottom>
            Nachrichten-Verlauf (7 Tage)
          </Typography>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dashboardStats.messageHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <ChartTooltip />
              <Line type="monotone" dataKey="sent" stroke="#8884d8" name="Gesendet" />
              <Line type="monotone" dataKey="received" stroke="#82ca9d" name="Empfangen" />
            </LineChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {/* Instanzen Grid */}
      <Grid container spacing={3}>
        {instances?.instances?.map((instance) => (
          <Grid item xs={12} sm={6} md={4} key={instance.instanceId}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Box display="flex" justifyContent="between" alignItems="flex-start" mb={2}>
                  <Box flex={1}>
                    <Typography variant="h6" gutterBottom>
                      {instance.name}
                    </Typography>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                      {instance.description || 'Keine Beschreibung'}
                    </Typography>
                  </Box>
                  <Chip
                    label={getStatusText(instance.status)}
                    color={getStatusColor(instance.status)}
                    size="small"
                  />
                </Box>

                {instance.phoneNumber && (
                  <Typography variant="body2" gutterBottom>
                    📱 +{instance.phoneNumber}
                  </Typography>
                )}

                <Box display="flex" justifyContent="space-between" mt={2}>
                  <Typography variant="caption" color="textSecondary">
                    Nachrichten: {instance.stats?.totalMessages || 0}
                  </Typography>
                  <Typography variant="caption" color="textSecondary">
                    Uptime: {instance.runtime?.uptime ? Math.floor(instance.runtime.uptime / 3600) : 0}h
                  </Typography>
                </Box>
              </CardContent>

              <CardActions>
                {instance.status === 'ready' ? (
                  <Tooltip title="Stoppen">
                    <IconButton
                      onClick={() => stopMutation.mutate(instance.instanceId)}
                      disabled={stopMutation.isLoading}
                    >
                      <StopIcon />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Tooltip title="Starten">
                    <IconButton
                      onClick={() => startMutation.mutate(instance.instanceId)}
                      disabled={startMutation.isLoading}
                    >
                      <PlayIcon />
                    </IconButton>
                  </Tooltip>
                )}

                <Tooltip title="Neustarten">
                  <IconButton
                    onClick={() => restartMutation.mutate(instance.instanceId)}
                    disabled={restartMutation.isLoading}
                  >
                    <RestartIcon />
                  </IconButton>
                </Tooltip>

                {instance.status === 'qr_pending' && (
                  <Tooltip title="QR-Code anzeigen">
                    <IconButton onClick={() => fetchQRCode(instance.instanceId)}>
                      <QrCodeIcon />
                    </IconButton>
                  </Tooltip>
                )}

                <Tooltip title="Nachrichten">
                  <IconButton
                    onClick={() => {
                      setSelectedInstance(instance);
                      setMessageDialogOpen(true);
                    }}
                    disabled={instance.status !== 'ready'}
                  >
                    <MessageIcon />
                  </IconButton>
                </Tooltip>

                <Tooltip title="Löschen">
                  <IconButton
                    onClick={() => deleteMutation.mutate(instance.instanceId)}
                    disabled={deleteMutation.isLoading}
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </CardActions>
            </Card>
          </Grid>
        ))}

        {/* Instanz hinzufügen Card */}
        <Grid item xs={12} sm={6} md={4}>
          <Card
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              '&:hover': { bgcolor: 'action.hover' }
            }}
            onClick={() => setCreateDialogOpen(true)}
          >
            <CardContent>
              <Box display="flex" flexDirection="column" alignItems="center">
                <AddIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" color="primary">
                  Neue Instanz erstellen
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Floating Action Button */}
      <Fab
        color="primary"
        aria-label="add"
        sx={{ position: 'fixed', bottom: 16, right: 16 }}
        onClick={() => setCreateDialogOpen(true)}
      >
        <AddIcon />
      </Fab>

      {/* Dialoge */}
      <CreateInstanceDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />

      <QRCodeDialog
        open={qrDialogOpen}
        onClose={() => setQrDialogOpen(false)}
        qrCode={qrCode}
      />

      <MessageDialog
        open={messageDialogOpen}
        onClose={() => setMessageDialogOpen(false)}
        instance={selectedInstance}
      />
    </Box>
  );
};

export default Dashboard;