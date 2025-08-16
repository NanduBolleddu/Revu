const mongoose = require('mongoose');

const annotationSchema = new mongoose.Schema({
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
  type: {
    type: String,
    enum: ['point', 'rectangle', 'text'],
    default: 'point'
  },
  coordinates: {
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    // For rectangle annotations
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 }
  },
  // For video annotations - timestamp in seconds
  timestamp: {
    type: Number,
    default: undefined
  },
  text: String, // Optional annotation text
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Compound index for efficient queries
annotationSchema.index({ mediaId: 1, createdAt: 1 });
annotationSchema.index({ mediaId: 1, timestamp: 1 }); // For video annotations

module.exports = mongoose.model('Annotation', annotationSchema);
