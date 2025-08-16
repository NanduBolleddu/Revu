const express = require('express');
const Comment = require('../models/Comment');
const router = express.Router();

// GET /comments?media_id=uuid
router.get('/', async (req, res) => {
  const { media_id } = req.query;
  
  if (!media_id) {
    return res.status(400).json({ error: 'media_id is required' });
  }

  try {
    const comments = await Comment.find({ mediaId: media_id })
      .sort({ createdAt: 1 })
      .lean();
    
    res.json(comments);
  } catch (err) {
    console.error('Error fetching comments:', err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /comments
router.post('/', async (req, res) => {
  const { media_id, user_id, username, text } = req.body;

  if (!media_id || !text?.trim()) {
    return res.status(400).json({ error: 'media_id and text are required' });
  }

  try {
    const comment = new Comment({
      mediaId: media_id,
      userId: user_id,
      username: username || 'Anonymous',
      text: text.trim()
    });

    const savedComment = await comment.save();
    res.status(201).json(savedComment);
  } catch (err) {
    console.error('Error creating comment:', err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

module.exports = router;
