import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Button,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Fab,
  Menu,
  MenuItem,
  CircularProgress,
  Alert
} from '@mui/material';
import {
  Add as AddIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
  Delete as DeleteIcon,
  QrCode as QrCodeIcon,
  MoreVert as MoreIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import Layout from '../components/layout/Layout';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import apiClient from '../services/apiClient';

export default function InstancesPage() {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [selectedInstance, setSelectedInstance] = useState(null);
  const [actionLoading, setActionLoading] = useState({});
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuInstance, setMenuInstance] = useState(null);

  // Create instance form
  const [newInstanceName, setNewInstanceName] = useState('');
  const [newInstanceDescription, setNewInstanceDescription] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  const { user } = useAuth();
  const { showSuccess, showError, showInfo } = useNotification();

  useEffect(() => {
    fetchInstances();

    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchInstances, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchInstances = async () => {
    try {
      const response = await apiClient.getInstances();
      setInstances(response.instances || []);
    } catch (error) {
      console.error('Failed to fetch instances:', error);
      showError('Failed to load instances');
    } finally {
      setLoading(false);
    }
  };

  const createInstance = async () => {
    if (!newInstanceName.trim()) {
      showError('Instance name is required');
      return;
    }

    setCreateLoading(true);
    try {
      const instanceData = {
        name: newInstanceName.trim(),
        description: newInstanceDescription.trim()
      };

      const response = await apiClient.createInstance(instanceData);

      if (response.instance) {
        showSuccess(`Instance "${response.instance.name}" created successfully!`);
        setInstances(prev => [response.instance, ...prev]);
        setCreateDialogOpen(false);
        setNewInstanceName('');
        setNewInstanceDescription('');
      }
    } catch (error) {
      showError(`Failed to create instance: ${error.message}`);
    } finally {
      setCreateLoading(false);
    }
  };

  const startInstance = async (instanceId, instanceName) => {
    setActionLoading(prev => ({ ...prev, [instanceId]: 'starting' }));
    try {
      await apiClient.startInstance(instanceId);
      showSuccess(`Starting "${instanceName}"...`);

      // Update instance status optimistically
      setInstances(prev => prev.map(inst =>
        inst.instanceId === instanceId
          ? { ...inst, status: 'connecting' }
          : inst
      ));

      // Refresh after a delay to get real status
      setTimeout(fetchInstances, 3000);
    } catch (error) {
      showError(`Failed to start instance: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [instanceId]: null }));
    }
  };

  const deleteInstance = async (instanceId, instanceName) => {
    if (!confirm(`Are you sure you want to delete "${instanceName}"?`)) {
      return;
    }

    setActionLoading(prev => ({ ...prev, [instanceId]: 'deleting' }));
    try {
      await apiClient.deleteInstance(instanceId);
      showSuccess(`Instance "${instanceName}" deleted`);
      setInstances(prev => prev.filter(inst => inst.instanceId !== instanceId));
    } catch (error) {
      showError(`Failed to delete instance: ${error.message}`);
    } finally {
      setActionLoading(prev => ({ ...prev, [instanceId]: null }));
    }
  };

  const showQRCode = async (instance) => {
    setSelectedInstance(instance);
    setQrDialogOpen(true);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return '#00C851';
      case 'connecting': return '#ff9800';
      case 'qr_pending': return '#2196f3';
      case 'error': return '#ff1744';
      default: return '#666666';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'ready': return 'Ready';
      case 'connecting': return 'Connecting';
      case 'qr_pending': return 'QR Required';
      case 'authenticated': return 'Authenticated';
      case 'error': return 'Error';
      case 'stopped': return 'Stopped';
      default: return 'Unknown';
    }
  };

  return (
    <ProtectedRoute>
      <Layout>
        {/* Header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Box>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 500,
                color: '#000000',
                mb: 0.5
              }}
            >
              WhatsApp Instances
            </Typography>
            <Typography
              variant="body1"
              sx={{
                color: '#666666',
                fontSize: '0.875rem'
              }}
            >
              Manage your WhatsApp accounts
            </Typography>
          </Box>

          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setCreateDialogOpen(true)}
            sx={{
              backgroundColor: '#000000',
              color: '#ffffff',
              '&:hover': {
                backgroundColor: '#333333',
              },
            }}
          >
            Create Instance
          </Button>
        </Box>

        {/* Instance Grid */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : instances.length === 0 ? (
          <Card sx={{ border: '1px solid #f0f0f0', boxShadow: 'none' }}>
            <CardContent sx={{ textAlign: 'center', py: 6 }}>
              <Typography variant="h6" sx={{ color: '#666666', mb: 2 }}>
                No instances created yet
              </Typography>
              <Typography variant="body2" sx={{ color: '#999999', mb: 3 }}>
                Create your first WhatsApp instance to get started
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateDialogOpen(true)}
                sx={{
                  backgroundColor: '#000000',
                  '&:hover': { backgroundColor: '#333333' }
                }}
              >
                Create First Instance
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Grid container spacing={2}>
            {instances.map((instance) => (
              <Grid item xs={12} sm={6} lg={4} key={instance.instanceId}>
                <Card
                  sx={{
                    border: '1px solid #f0f0f0',
                    boxShadow: 'none',
                    '&:hover': {
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    },
                  }}
                >
                  <CardContent sx={{ p: 3 }}>
                    {/* Instance Header */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                      <Box sx={{ flex: 1 }}>
                        <Typography
                          variant="h6"
                          sx={{
                            fontWeight: 500,
                            color: '#000000',
                            fontSize: '1rem',
                            mb: 0.5
                          }}
                        >
                          {instance.name}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            color: '#666666',
                            fontSize: '0.75rem'
                          }}
                        >
                          {instance.description || 'No description'}
                        </Typography>
                      </Box>

                      <IconButton
                        size="small"
                        onClick={(e) => {
                          setMenuAnchor(e.currentTarget);
                          setMenuInstance(instance);
                        }}
                        sx={{ color: '#666666' }}
                      >
                        <MoreIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    {/* Status Indicator */}
                    <Box sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: getStatusColor(instance.status),
                            mr: 1
                          }}
                        />
                        <Typography
                          variant="body2"
                          sx={{
                            color: '#000000',
                            fontSize: '0.875rem',
                            fontWeight: 500
                          }}
                        >
                          {getStatusText(instance.status)}
                        </Typography>
                      </Box>

                      {instance.phoneNumber && (
                        <Typography
                          variant="body2"
                          sx={{
                            color: '#666666',
                            fontSize: '0.75rem'
                          }}
                        >
                          Phone: {instance.phoneNumber}
                        </Typography>
                      )}
                    </Box>

                    {/* Action Buttons */}
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                      {instance.status === 'ready' ? (
                        <Button
                          size="small"
                          variant="outlined"
                          disabled
                          sx={{
                            fontSize: '0.75rem',
                            color: '#00C851',
                            borderColor: '#00C851'
                          }}
                        >
                          Running
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={
                            actionLoading[instance.instanceId] === 'starting' ? (
                              <CircularProgress size={12} />
                            ) : (
                              <PlayIcon />
                            )
                          }
                          onClick={() => startInstance(instance.instanceId, instance.name)}
                          disabled={!!actionLoading[instance.instanceId]}
                          sx={{
                            fontSize: '0.75rem',
                            borderColor: '#e0e0e0',
                            color: '#000000',
                            '&:hover': {
                              borderColor: '#000000',
                              backgroundColor: 'rgba(0,0,0,0.04)',
                            }
                          }}
                        >
                          Start
                        </Button>
                      )}

                      {(instance.status === 'qr_pending' || instance.status === 'connecting') && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<QrCodeIcon />}
                          onClick={() => showQRCode(instance)}
                          sx={{
                            fontSize: '0.75rem',
                            borderColor: '#e0e0e0',
                            color: '#000000',
                            '&:hover': {
                              borderColor: '#000000',
                              backgroundColor: 'rgba(0,0,0,0.04)',
                            }
                          }}
                        >
                          QR Code
                        </Button>
                      )}
                    </Box>

                    {/* Instance Info */}
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #f8f8f8' }}>
                      <Typography
                        variant="caption"
                        sx={{
                          color: '#999999',
                          fontSize: '0.7rem',
                          display: 'block'
                        }}
                      >
                        ID: {instance.instanceId}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: '#999999',
                          fontSize: '0.7rem'
                        }}
                      >
                        Created: {new Date(instance.createdAt).toLocaleDateString()}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Create Instance Dialog */}
        <Dialog
          open={createDialogOpen}
          onClose={() => setCreateDialogOpen(false)}
          maxWidth="sm"
          fullWidth
          PaperProps={{
            sx: {
              borderRadius: 2,
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            }
          }}
        >
          <DialogTitle sx={{ pb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 500 }}>
              Create WhatsApp Instance
            </Typography>
          </DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Instance Name"
              value={newInstanceName}
              onChange={(e) => setNewInstanceName(e.target.value)}
              margin="normal"
              placeholder="e.g., Customer Support, Marketing Bot"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1,
                }
              }}
            />
            <TextField
              fullWidth
              label="Description (optional)"
              value={newInstanceDescription}
              onChange={(e) => setNewInstanceDescription(e.target.value)}
              margin="normal"
              multiline
              rows={2}
              placeholder="Brief description of this instance"
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1,
                }
              }}
            />

            <Alert
              severity="info"
              sx={{
                mt: 2,
                borderRadius: 1,
                backgroundColor: '#f0f8ff',
                color: '#1976d2'
              }}
            >
              Each instance represents one WhatsApp account. You'll need to scan a QR code to connect.
            </Alert>
          </DialogContent>
          <DialogActions sx={{ p: 3, pt: 1 }}>
            <Button
              onClick={() => setCreateDialogOpen(false)}
              disabled={createLoading}
              sx={{ color: '#666666' }}
            >
              Cancel
            </Button>
            <Button
              onClick={createInstance}
              disabled={createLoading || !newInstanceName.trim()}
              variant="contained"
              startIcon={createLoading ? <CircularProgress size={16} /> : <AddIcon />}
              sx={{
                backgroundColor: '#000000',
                '&:hover': { backgroundColor: '#333333' }
              }}
            >
              {createLoading ? 'Creating...' : 'Create Instance'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Instance Menu */}
        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
        >
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              if (menuInstance) {
                showQRCode(menuInstance);
              }
            }}
            disabled={!['qr_pending', 'connecting'].includes(menuInstance?.status)}
          >
            <QrCodeIcon sx={{ mr: 1, fontSize: 16 }} />
            Show QR Code
          </MenuItem>
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              if (menuInstance) {
                deleteInstance(menuInstance.instanceId, menuInstance.name);
              }
            }}
            sx={{ color: '#ff1744' }}
          >
            <DeleteIcon sx={{ mr: 1, fontSize: 16 }} />
            Delete Instance
          </MenuItem>
        </Menu>

        {/* QR Code Dialog - Will implement in next component */}
        <Dialog
          open={qrDialogOpen}
          onClose={() => setQrDialogOpen(false)}
          maxWidth="sm"
          PaperProps={{
            sx: {
              borderRadius: 2,
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            }
          }}
        >
          <DialogTitle sx={{ textAlign: 'center' }}>
            WhatsApp Authentication
          </DialogTitle>
          <DialogContent sx={{ textAlign: 'center', py: 3 }}>
            <Typography variant="body1" sx={{ mb: 2 }}>
              QR Code for: {selectedInstance?.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Scan this QR code with your WhatsApp app
            </Typography>

            {/* QR Code will be implemented here */}
            <Box
              sx={{
                width: 256,
                height: 256,
                backgroundColor: '#f5f5f5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
                borderRadius: 1
              }}
            >
              <Typography variant="body2" color="text.secondary">
                QR Code Loading...
              </Typography>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setQrDialogOpen(false)}>
              Close
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />}>
              Refresh QR
            </Button>
          </DialogActions>
        </Dialog>

        {/* Floating Action Button */}
        <Fab
          color="primary"
          onClick={() => setCreateDialogOpen(true)}
          sx={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            backgroundColor: '#000000',
            '&:hover': {
              backgroundColor: '#333333',
            }
          }}
        >
          <AddIcon />
        </Fab>
      </Layout>
    </ProtectedRoute>
  );
}