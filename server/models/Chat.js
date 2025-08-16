const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  participants: [{
    userId: { type: String, required: true },
    username: { type: String, required: true },
    avatar: String,
    lastSeen: { type: Date, default: Date.now }
  }],
  lastMessage: {
    senderId: String,
    text: String,
    timestamp: Date,
    messageType: { type: String, default: 'text' }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Index for efficient queries
chatSchema.index({ 'participants.userId': 1 });
chatSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Chat', chatSchema);
