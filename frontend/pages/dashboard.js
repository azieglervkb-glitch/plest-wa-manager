import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  LinearProgress
} from '@mui/material';
import {
  TrendingUp,
  Memory,
  Speed,
  PhoneAndroid
} from '@mui/icons-material';
import Layout from '../components/layout/Layout';
import ProtectedRoute from '../components/auth/ProtectedRoute';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../services/apiClient';

export default function DashboardPage() {
  const [systemHealth, setSystemHealth] = useState(null);
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    fetchDashboardData();

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [healthResponse, instancesResponse] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getInstances().catch(() => ({ instances: [] }))
      ]);

      setSystemHealth(healthResponse);
      setInstances(instancesResponse.instances || []);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'ready': return 'success';
      case 'connecting': return 'warning';
      case 'error': return 'error';
      case 'qr_pending': return 'info';
      default: return 'default';
    }
  };

  const getHealthColor = (status) => {
    return status === 'healthy' ? 'success' : 'error';
  };

  if (loading) {
    return (
      <ProtectedRoute>
        <Layout>
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <LinearProgress sx={{ width: '50%' }} />
          </Box>
        </Layout>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <Layout>
        {/* Welcome Header */}
        <Box sx={{ mb: 4 }}>
          <Typography variant="h4" gutterBottom>
            Welcome back, {user?.username}! 👋
          </Typography>
          <Typography variant="body1" color="text.secondary">
            WhatsApp Multi-Instance Manager Dashboard
          </Typography>
        </Box>

        {/* System Overview Cards */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <PhoneAndroid sx={{ fontSize: 40, color: 'primary.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {instances.length}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Total Instances
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <TrendingUp sx={{ fontSize: 40, color: 'success.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {instances.filter(i => i.status === 'ready').length}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Active Instances
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Memory sx={{ fontSize: 40, color: 'warning.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {systemHealth?.memory || '0MB'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Memory Usage
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Speed sx={{ fontSize: 40, color: 'info.main', mr: 2 }} />
                  <Box>
                    <Typography variant="h4" component="div">
                      {systemHealth?.uptime ? Math.floor(systemHealth.uptime / 3600) + 'h' : '0h'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Uptime
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* System Status */}
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  System Health
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Chip
                    label={systemHealth?.status || 'Unknown'}
                    color={getHealthColor(systemHealth?.status)}
                    variant="outlined"
                  />
                  <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                    Last updated: {systemHealth?.timestamp ? new Date(systemHealth.timestamp).toLocaleTimeString() : 'Unknown'}
                  </Typography>
                </Box>

                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" gutterBottom>
                    MongoDB: {systemHealth?.mongodb === 'connected' ? '🟢 Connected' : '🔴 Disconnected'}
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    Version: {systemHealth?.version || 'Unknown'}
                  </Typography>
                  <Typography variant="body2">
                    Server: wa.plest.de
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Recent Instances
                </Typography>
                {instances.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No instances created yet.
                  </Typography>
                ) : (
                  <Box>
                    {instances.slice(0, 5).map((instance) => (
                      <Box
                        key={instance.instanceId}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          py: 1
                        }}
                      >
                        <Typography variant="body2">
                          {instance.name}
                        </Typography>
                        <Chip
                          label={instance.status}
                          size="small"
                          color={getStatusColor(instance.status)}
                          variant="outlined"
                        />
                      </Box>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Layout>
    </ProtectedRoute>
  );
}