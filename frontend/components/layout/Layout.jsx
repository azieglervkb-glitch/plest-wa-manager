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
  CheckCircle as HealthIcon
} from '@mui/icons-material';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import Link from 'next/link';

const drawerWidth = 200; // Smaller sidebar

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
      {/* Minimal Logo */}
      <Box
        sx={{
          p: 2,
          textAlign: 'center',
          borderBottom: '1px solid #f0f0f0',
          backgroundColor: '#ffffff'
        }}
      >
        <Typography
          variant="h6"
          sx={{
            color: '#000000',
            fontWeight: 500,
            fontSize: '1rem'
          }}
        >
          WhatsApp Manager
        </Typography>
      </Box>

      {/* Clean Navigation */}
      <List sx={{ pt: 1 }}>
        {menuItems.map((item) => {
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
                  mx: 1,
                  mb: 0.5,
                  borderRadius: 1,
                  '&.Mui-selected': {
                    backgroundColor: '#f5f5f5',
                    color: '#000000',
                    '& .MuiListItemIcon-root': {
                      color: '#000000',
                    },
                  },
                  '&:hover': {
                    backgroundColor: '#f9f9f9',
                  },
                }}
              >
                <ListItemIcon sx={{ color: '#666666', minWidth: 36 }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.text}
                  primaryTypographyProps={{
                    fontSize: '0.875rem',
                    fontWeight: isActive ? 500 : 400
                  }}
                />
              </ListItem>
            </Link>
          );
        })}
      </List>

      <Divider sx={{ mx: 1, backgroundColor: '#f0f0f0' }} />

      {/* Minimal System Status */}
      <Box sx={{ p: 2 }}>
        <Typography
          variant="caption"
          sx={{
            color: '#999999',
            fontSize: '0.7rem',
            display: 'block',
            mb: 1
          }}
        >
          System Status
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: '#00C851',
              mr: 1
            }}
          />
          <Typography
            variant="body2"
            sx={{
              color: '#666666',
              fontSize: '0.75rem'
            }}
          >
            Online
          </Typography>
        </Box>
      </Box>
    </div>
  );

  return (
    <Box sx={{ display: 'flex' }}>
      {/* Minimal App Bar */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          ml: { sm: `${drawerWidth}px` },
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #f0f0f0'
        }}
      >
        <Toolbar sx={{ minHeight: '56px !important' }}>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{
              mr: 2,
              display: { sm: 'none' },
              color: '#000000'
            }}
          >
            <MenuIcon />
          </IconButton>

          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{
              flexGrow: 1,
              color: '#000000',
              fontWeight: 500,
              fontSize: '1rem'
            }}
          >
            Admin Panel
          </Typography>

          {/* Minimal User Menu */}
          <Tooltip title="Account">
            <IconButton
              onClick={handleUserMenuOpen}
              sx={{ color: '#000000' }}
            >
              <Avatar
                sx={{
                  width: 28,
                  height: 28,
                  backgroundColor: '#f5f5f5',
                  color: '#000000',
                  fontSize: '0.75rem'
                }}
              >
                {user?.username?.charAt(0).toUpperCase() || 'A'}
              </Avatar>
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={userMenuAnchor}
            open={Boolean(userMenuAnchor)}
            onClose={handleUserMenuClose}
            onClick={handleUserMenuClose}
            sx={{
              '& .MuiPaper-root': {
                borderRadius: 1,
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                border: '1px solid #f0f0f0'
              }
            }}
          >
            <MenuItem disabled sx={{ fontSize: '0.75rem' }}>
              <AccountCircle sx={{ mr: 1, fontSize: 16 }} />
              {user?.email}
            </MenuItem>
            <Divider />
            <MenuItem onClick={handleLogout} sx={{ fontSize: '0.75rem' }}>
              <LogoutIcon sx={{ mr: 1, fontSize: 16 }} />
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
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              backgroundColor: '#ffffff',
              borderRight: '1px solid #f0f0f0'
            },
          }}
        >
          {drawer}
        </Drawer>

        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: drawerWidth,
              backgroundColor: '#ffffff',
              borderRight: '1px solid #f0f0f0'
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* Minimal Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - ${drawerWidth}px)` },
          mt: 7, // Smaller header offset
          backgroundColor: '#ffffff'
        }}
      >
        {children}
      </Box>
    </Box>
  );
}