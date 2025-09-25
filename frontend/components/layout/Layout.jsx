import React, { useState } from 'react';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Avatar,
  Menu,
  MenuItem,
  Badge,
  Tooltip
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  PhoneAndroid as InstanceIcon,
  Analytics as AnalyticsIcon,
  People as UsersIcon,
  Settings as SettingsIcon,
  ExitToApp as LogoutIcon,
  AccountCircle,
  Notifications as NotificationsIcon,
  Health as HealthIcon
} from '@mui/icons-material';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import Link from 'next/link';

const drawerWidth = 240;

const menuItems = [
  { text: 'Dashboard', icon: <DashboardIcon />, href: '/dashboard' },
  { text: 'Instances', icon: <InstanceIcon />, href: '/instances' },
  { text: 'Analytics', icon: <AnalyticsIcon />, href: '/analytics' },
  { text: 'Users', icon: <UsersIcon />, href: '/users', adminOnly: true },
  { text: 'Settings', icon: <SettingsIcon />, href: '/settings' },
];

export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState(null);
  const { user, logout, isAdmin } = useAuth();
  const router = useRouter();

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleUserMenuOpen = (event) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = () => {
    handleUserMenuClose();
    logout();
  };

  const drawer = (
    <div>
      {/* Logo/Header */}
      <Box sx={{ p: 2, textAlign: 'center', borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="h6" color="primary" fontWeight="bold">
          📱 WhatsApp Manager
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Admin Panel
        </Typography>
      </Box>

      {/* Navigation Menu */}
      <List>
        {menuItems.map((item) => {
          // Hide admin-only items for non-admins
          if (item.adminOnly && !isAdmin()) {
            return null;
          }

          const isActive = router.pathname === item.href;

          return (
            <Link href={item.href} key={item.text} passHref>
              <ListItem
                button
                selected={isActive}
                sx={{
                  '&.Mui-selected': {
                    backgroundColor: 'primary.main',
                    color: 'white',
                    '& .MuiListItemIcon-root': {
                      color: 'white',
                    },
                  },
                }}
              >
                <ListItemIcon>
                  {item.icon}
                </ListItemIcon>
                <ListItemText primary={item.text} />
              </ListItem>
            </Link>
          );
        })}
      </List>

      <Divider />

      {/* System Status */}
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary" display="block">
          System Status
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
          <HealthIcon sx={{ fontSize: 16, color: 'success.main', mr: 1 }} />
          <Typography variant="body2" color="success.main">
            Healthy
          </Typography>
        </Box>
      </Box>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      {/* App Bar */}
      <AppBar
        position="fixed"
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
        }}
      >
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
            WhatsApp Manager
          </Typography>

          {/* Notifications */}
          <Tooltip title="Notifications">
            <IconButton color="inherit">
              <Badge badgeContent={0} color="error">
                <NotificationsIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          {/* User Menu */}
          <Tooltip title="Account">
            <IconButton
              color="inherit"
              onClick={handleUserMenuOpen}
            >
              <Avatar sx={{ width: 32, height: 32 }}>
                {user?.username?.charAt(0).toUpperCase() || 'A'}
              </Avatar>
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={handleUserMenuClose}
            onClick={handleUserMenuClose}
          >
            <MenuItem disabled>
              <AccountCircle sx={{ mr: 1 }} />
              {user?.email}
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <LogoutIcon sx={{ mr: 1 }} />
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Mobile Drawer */}
      <Box
        component="nav"
        sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better mobile performance
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>

        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: 8 // Account for AppBar height
        }}
      >
        {children}
      </Box>
    </Box>
  );
}