const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  mediaId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: true
  },
  text: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient queries by media
commentSchema.index({ mediaId: 1, createdAt: 1 });

module.exports = mongoose.model('Comment', commentSchema);
