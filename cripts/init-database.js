const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import models
const User = require('../models/User');
const Season = require('../models/Season');

/**
 * Initialize Database
 * - Connect to MongoDB
 * - Create collections
 * - Set up indexes
 * - Generate seasons for 2026
 */
async function initializeDatabase() {
  try {
    console.log('🔄 Initializing database...\n');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    // Create collections and indexes
    console.log('📋 Creating collections and indexes...');
    
    // User collection
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ sportClubMembershipNumber: 1 }, { unique: true });
    await User.collection.createIndex({ rating: -1, paused: 1, frozen: 1 });
    await User.collection.createIndex({ createdAt: -1 });
    console.log('  ✓ User collection indexes created');

    // Season collection
    await Season.collection.createIndex({ status: 1, startDate: 1, endDate: 1 });
    await Season.collection.createIndex({ year: 1, name: 1 });
    console.log('  ✓ Season collection indexes created');

    console.log('✅ Collections and indexes created\n');

    // Check if seasons already exist for 2026
    console.log('🔍 Checking for existing seasons...');
    const existingSeasons = await Season.find({ year: 2026 });
    
    if (existingSeasons.length > 0) {
      console.log(`✅ Seasons for 2026 already exist (${existingSeasons.length} seasons found)\n`);
    } else {
      // Create seasons for 2026
      console.log('🌍 Creating seasons for 2026...');
      const seasons = await Season.createSeasonsForYear(2026);
      
      console.log(`✅ Created ${seasons.length} seasons for 2026:`);
      seasons.forEach(season => {
        console.log(`  ✓ ${season.name} 2026 (${season.startDate.toDateString()} - ${season.endDate.toDateString()})`);
      });
      console.log();
    }

    // Create admin user if it doesn't exist
    console.log('👤 Setting up admin account...');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tennisladder.com';
    const existingAdmin = await User.findOne({ email: adminEmail });

    if (existingAdmin) {
      console.log(`✅ Admin account already exists: ${adminEmail}\n`);
    } else {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('AdminPassword123!', 10);

      const admin = new User({
        email: adminEmail,
        password: hashedPassword,
        firstName: 'Admin',
        lastName: 'User',
        sportClubMembershipNumber: 'ADMIN001',
        rating: 3.0, // Professional level
        gender: 'other',
        role: 'admin',
        registeredAt: new Date()
      });

      await admin.save();
      console.log(`✅ Admin account created:`);
      console.log(`  📧 Email: ${adminEmail}`);
      console.log(`  🔑 Password: AdminPassword123!`);
      console.log(`  ⚠️  CHANGE THIS PASSWORD IMMEDIATELY in production!\n`);
    }

    // Display summary
    console.log('╔════════════════════════════════════════╗');
    console.log('║   ✅ DATABASE INITIALIZATION COMPLETE   ║');
    console.log('╠════════════════════════════════════════╣');
    console.log('║ Collections created                    ║');
    console.log('║ Indexes established                    ║');
    console.log('║ Seasons generated for 2026             ║');
    console.log('║ Admin account ready                    ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log('📝 Next steps:');
    console.log('  1. Set ADMIN_EMAIL in .env (currently: ' + adminEmail + ')');
    console.log('  2. Change admin password after first login');
    console.log('  3. Start server: npm run dev\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    console.error('\n🔍 Troubleshooting:');
    console.error('  • Verify MONGODB_URI in .env');
    console.error('  • Check MongoDB cluster is running');
    console.error('  • Verify IP whitelist in MongoDB Atlas');
    process.exit(1);
  }
}

// Run initialization
initializeDatabase();
