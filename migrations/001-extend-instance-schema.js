/**
 * Migration: Extend Instance Schema for Production Features
 *
 * Adds new fields for process management, health monitoring, and error tracking
 * to existing Instance documents in the database.
 */

const mongoose = require('mongoose');

async function up() {
  console.log('🔄 Running migration: Extend Instance Schema...');

  try {
    const db = mongoose.connection.db;
    const collection = db.collection('instances');

    // Update all existing instances with new fields
    const result = await collection.updateMany(
      {}, // All documents
      {
        $set: {
          // Process-Management fields (set to null for existing instances)
          processId: null,
          processPort: null,
          lastHeartbeat: new Date(),

          // Resource usage (initialize with zeros)
          'resourceUsage.memory': 0,
          'resourceUsage.cpu': 0,
          'resourceUsage.uptime': 0,

          // Error tracking (initialize with defaults)
          errorCount: 0,
          lastError: {},
          restartCount: 0,

          // Session backup (enable by default)
          'sessionBackup.enabled': true,
          'sessionBackup.lastBackup': null,
          'sessionBackup.backupPath': null,
          'sessionBackup.backupSize': 0
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} instance documents`);

    // Add indexes for new fields
    await collection.createIndex({ processId: 1 });
    await collection.createIndex({ lastHeartbeat: 1 });
    await collection.createIndex({ errorCount: 1 });

    console.log('✅ Created indexes for new fields');

    // Cleanup any instances with invalid status
    const cleanupResult = await collection.updateMany(
      { status: { $nin: ['created', 'connecting', 'qr_pending', 'authenticated', 'ready', 'disconnected', 'error', 'stopped'] } },
      { $set: { status: 'error' } }
    );

    if (cleanupResult.modifiedCount > 0) {
      console.log(`✅ Cleaned up ${cleanupResult.modifiedCount} instances with invalid status`);
    }

    console.log('🎉 Migration completed successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

async function down() {
  console.log('🔄 Rolling back migration: Extend Instance Schema...');

  try {
    const db = mongoose.connection.db;
    const collection = db.collection('instances');

    // Remove the new fields
    const result = await collection.updateMany(
      {},
      {
        $unset: {
          processId: '',
          processPort: '',
          lastHeartbeat: '',
          resourceUsage: '',
          errorCount: '',
          lastError: '',
          restartCount: '',
          sessionBackup: ''
        }
      }
    );

    console.log(`✅ Removed new fields from ${result.modifiedCount} instance documents`);

    // Drop indexes
    try {
      await collection.dropIndex({ processId: 1 });
      await collection.dropIndex({ lastHeartbeat: 1 });
      await collection.dropIndex({ errorCount: 1 });
      console.log('✅ Dropped indexes for new fields');
    } catch (error) {
      console.log('⚠️  Some indexes might not exist, continuing...');
    }

    console.log('🎉 Rollback completed successfully!');

  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  }
}

module.exports = { up, down };

// CLI usage if run directly
if (require.main === module) {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp-manager';

  async function runMigration() {
    try {
      await mongoose.connect(MONGODB_URI);
      console.log('✅ Connected to MongoDB');

      const command = process.argv[2];
      if (command === 'up') {
        await up();
      } else if (command === 'down') {
        await down();
      } else {
        console.log('Usage: node 001-extend-instance-schema.js [up|down]');
        process.exit(1);
      }

      await mongoose.disconnect();
      console.log('✅ Migration completed, disconnected from MongoDB');
      process.exit(0);

    } catch (error) {
      console.error('❌ Migration error:', error);
      process.exit(1);
    }
  }

  runMigration();
}