const mongoose = require('mongoose');
require('dotenv').config();

const connectMongoDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27017/revu?authSource=admin';

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Auto-create collections with initial setup
    await initializeCollections();

  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  }
};

// Function to initialize collections if they don't exist
// Function to initialize collections if they don't exist
const initializeCollections = async () => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(col => col.name);

    // Create comments collection if it doesn't exist
    if (!collectionNames.includes('comments')) {
      await mongoose.connection.db.createCollection('comments');
      console.log('✅ Comments collection created');
    }

    // Create annotations collection if it doesn't exist
    if (!collectionNames.includes('annotations')) {
      await mongoose.connection.db.createCollection('annotations');
      console.log('✅ Annotations collection created');
    }

    // Create mediashares collection if it doesn't exist
    if (!collectionNames.includes('mediashares')) {
      await mongoose.connection.db.createCollection('mediashares');
      console.log('✅ MediaShares collection created');
    }

    console.log('📦 Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing collections:', error.message);
  }
};


// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed gracefully');
    process.exit(0);
  } catch (error) {
    console.error('Error closing MongoDB connection:', error);
    process.exit(1);
  }
});

module.exports = connectMongoDB;
