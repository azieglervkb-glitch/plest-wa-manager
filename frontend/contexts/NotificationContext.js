import React, { createContext, useContext } from 'react';
import { SnackbarProvider, useSnackbar } from 'notistack';
import { IconButton } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

const NotificationContext = createContext();

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

const NotificationHandler = ({ children }) => {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const showSuccess = (message) => {
    enqueueSnackbar(message, {
      variant: 'success',
      autoHideDuration: 3000,
      action: (key) => (
        <IconButton size="small" onClick={() => closeSnackbar(key)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      ),
    });
  };

  const showError = (message) => {
    enqueueSnackbar(message, {
      variant: 'error',
      autoHideDuration: 5000,
      action: (key) => (
        <IconButton size="small" onClick={() => closeSnackbar(key)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      ),
    });
  };

  const showWarning = (message) => {
    enqueueSnackbar(message, {
      variant: 'warning',
      autoHideDuration: 4000,
      action: (key) => (
        <IconButton size="small" onClick={() => closeSnackbar(key)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      ),
    });
  };

  const showInfo = (message) => {
    enqueueSnackbar(message, {
      variant: 'info',
      autoHideDuration: 3000,
      action: (key) => (
        <IconButton size="small" onClick={() => closeSnackbar(key)}>
          <CloseIcon fontSize="small" />
        </IconButton>
      ),
    });
  };

  const value = {
    showSuccess,
    showError,
    showWarning,
    showInfo
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export const NotificationProvider = ({ children }) => {
  return (
    <SnackbarProvider
      maxSnack={3}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      dense={false}
    >
      <NotificationHandler>
        {children}
      </NotificationHandler>
    </SnackbarProvider>
  );
};