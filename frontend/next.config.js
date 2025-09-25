/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  // API proxy for development (points to wa.plest.de in production)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_ENV === 'production'
          ? '/api/:path*'  // Use same origin in production
          : 'http://wa.plest.de/api/:path*', // Proxy to live server in development
      },
    ];
  },

  // Output configuration for static export
  output: 'standalone',

  // Asset optimization
  images: {
    domains: ['wa.plest.de'],
    unoptimized: true // For better compatibility
  },

  // Build configuration
  distDir: 'build',

  // Environment variables
  env: {
    BACKEND_URL: process.env.BACKEND_URL || 'http://wa.plest.de',
    WS_URL: process.env.WS_URL || 'ws://wa.plest.de',
  },
};

module.exports = nextConfig;