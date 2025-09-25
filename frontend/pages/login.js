import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';
import LoginForm from '../components/auth/LoginForm';

export default function LoginPage() {
  const { isAuthenticated, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Redirect to dashboard if already authenticated
    if (!loading && isAuthenticated()) {
      router.push('/dashboard');
    }
  }, [isAuthenticated, loading, router]);

  // Don't render login form if already authenticated
  if (loading || isAuthenticated()) {
    return null;
  }

  return <LoginForm />;
}