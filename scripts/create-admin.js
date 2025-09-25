/**
 * Create initial admin user for WhatsApp Manager
 *
 * Usage:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secure123 node scripts/create-admin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('../models/User');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-manager';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@localhost';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

async function createAdminUser() {
  try {
    console.log('🔧 Creating admin user...');
    console.log('Database:', MONGODB_URI.replace(/\/\/.*@/, '//***:***@'));
    console.log('Admin Email:', ADMIN_EMAIL);

    // Connect to database
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({
      $or: [
        { email: ADMIN_EMAIL },
        { role: 'superadmin' }
      ]
    });

    if (existingAdmin) {
      console.log('⚠️  Admin user already exists:');
      console.log('   Email:', existingAdmin.email);
      console.log('   Role:', existingAdmin.role);
      console.log('   Created:', existingAdmin.createdAt);
      return;
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const adminUser = new User({
      username: 'admin',
      email: ADMIN_EMAIL,
      password: hashedPassword,
      role: 'superadmin',
      plan: 'enterprise',
      isActive: true,
      planLimits: {
        maxInstances: 999999,
        maxMessages: 999999,
        features: ['unlimited', 'api', 'webhooks', 'analytics', 'bulk-operations']
      },
      profile: {
        firstName: 'System',
        lastName: 'Administrator'
      }
    });

    await adminUser.save();

    console.log('🎉 Admin user created successfully!');
    console.log('');
    console.log('📋 Login credentials:');
    console.log('   Email:', ADMIN_EMAIL);
    console.log('   Password:', ADMIN_PASSWORD);
    console.log('   Role: superadmin');
    console.log('');
    console.log('🔗 Login URL:');
    console.log('   POST /api/auth/login');
    console.log('   Body: { "email": "' + ADMIN_EMAIL + '", "password": "' + ADMIN_PASSWORD + '" }');
    console.log('');
    console.log('⚠️  IMPORTANT: Change the password after first login!');

  } catch (error) {
    console.error('❌ Failed to create admin user:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  }
}

// Run if called directly
if (require.main === module) {
  createAdminUser();
}

module.exports = createAdminUser;