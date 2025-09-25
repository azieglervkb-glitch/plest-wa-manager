import React, { useState, useEffect } from 'react';
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  LinearProgress,
  Divider
} from '@mui/material';
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
        {/* Minimal Welcome Header */}
        <Box sx={{ mb: 4 }}>
          <Typography
            variant="h4"
            sx={{
              fontWeight: 500,
              color: '#000000',
              mb: 1
            }}
          >
            Dashboard
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: '#666666',
              fontSize: '0.875rem'
            }}
          >
            Welcome back, {user?.username}
          </Typography>
        </Box>

        {/* Clean Overview Cards */}
        <Grid container spacing={2} sx={{ mb: 4 }}>
          <Grid item xs={12} sm={6} md={3}>
            <Card
              sx={{
                border: '1px solid #f0f0f0',
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 600,
                    color: '#000000',
                    fontSize: '2rem',
                    mb: 1
                  }}
                >
                  {instances.length}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#666666',
                    fontSize: '0.75rem'
                  }}
                >
                  Total Instances
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card
              sx={{
                border: '1px solid #f0f0f0',
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 600,
                    color: '#00C851',
                    fontSize: '2rem',
                    mb: 1
                  }}
                >
                  {instances.filter(i => i.status === 'ready').length}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#666666',
                    fontSize: '0.75rem'
                  }}
                >
                  Active Instances
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card
              sx={{
                border: '1px solid #f0f0f0',
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 600,
                    color: '#666666',
                    fontSize: '2rem',
                    mb: 1
                  }}
                >
                  {systemHealth?.memory || '0MB'}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#666666',
                    fontSize: '0.75rem'
                  }}
                >
                  Memory Usage
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <Card
              sx={{
                border: '1px solid #f0f0f0',
                boxShadow: 'none',
                '&:hover': {
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                }
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 600,
                    color: '#666666',
                    fontSize: '2rem',
                    mb: 1
                  }}
                >
                  {systemHealth?.uptime ? Math.floor(systemHealth.uptime / 3600) + 'h' : '0h'}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#666666',
                    fontSize: '0.75rem'
                  }}
                >
                  Uptime
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Clean System Status */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <Card
              sx={{
                border: '1px solid #f0f0f0',
                boxShadow: 'none'
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 500,
                    color: '#000000',
                    fontSize: '1rem',
                    mb: 2
                  }}
                >
                  System Status
                </Typography>

                <Box sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: systemHealth?.mongodb === 'connected' ? '#00C851' : '#ff1744',
                        mr: 1
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        color: '#000000',
                        fontSize: '0.875rem'
                      }}
                    >
                      Database: {systemHealth?.mongodb === 'connected' ? 'Connected' : 'Disconnected'}
                    </Typography>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: systemHealth?.status === 'healthy' ? '#00C851' : '#ff1744',
                        mr: 1
                      }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        color: '#000000',
                        fontSize: '0.875rem'
                      }}
                    >
                      System: {systemHealth?.status || 'Unknown'}
                    </Typography>
                  </Box>
                </Box>

                <Divider sx={{ my: 2, backgroundColor: '#f0f0f0' }} />

                <Typography
                  variant="body2"
                  sx={{
                    color: '#666666',
                    fontSize: '0.75rem'
                  }}
                >
                  Version: {systemHealth?.version || 'Unknown'}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{
                    color: '#666666',
                    fontSize: '0.75rem'
                  }}
                >
                  Server: wa.plest.de
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6}>
            <Card
              sx={{
                border: '1px solid #f0f0f0',
                boxShadow: 'none'
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 500,
                    color: '#000000',
                    fontSize: '1rem',
                    mb: 2
                  }}
                >
                  Recent Activity
                </Typography>

                {instances.length === 0 ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: '#666666',
                      fontSize: '0.875rem'
                    }}
                  >
                    No instances created yet.
                  </Typography>
                ) : (
                  <Box>
                    {instances.slice(0, 3).map((instance) => (
                      <Box
                        key={instance.instanceId}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          py: 1,
                          borderBottom: '1px solid #f8f8f8',
                          '&:last-child': {
                            borderBottom: 'none'
                          }
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            color: '#000000',
                            fontSize: '0.875rem'
                          }}
                        >
                          {instance.name}
                        </Typography>
                        <Chip
                          label={instance.status}
                          size="small"
                          variant="outlined"
                          sx={{
                            fontSize: '0.7rem',
                            height: 20,
                            borderColor: '#e0e0e0',
                            color: '#666666'
                          }}
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