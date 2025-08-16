const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chat',
    required: true,
    index: true
  },
  senderId: {
    type: String,
    required: true,
    index: true
  },
  senderUsername: {
    type: String,
    required: true
  },
  receiverId: {
    type: String,
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  messageType: {
    type: String,
    enum: ['text', 'system'],
    default: 'text'
  },
  readBy: [{
    userId: String,
    readAt: Date
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for efficient queries
chatMessageSchema.index({ chatId: 1, createdAt: -1 });
chatMessageSchema.index({ senderId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
