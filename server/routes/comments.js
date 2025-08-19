const express = require('express');
const Comment = require('../models/Comment');
const pool = require('../config/db');
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
  const { media_id, user_id, text } = req.body;
  if (!media_id || !user_id || !text?.trim()) {
    return res.status(400).json({ error: 'media_id, user_id and text are required' });
  }

  try {
    // Query user from Postgres
    const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const username = userRes.rows[0].username;

    // Create MongoDB comment document with username from Postgres
    const comment = new Comment({
      mediaId: media_id,
      userId: user_id,
      username,
      text: text.trim(),
    });

    const savedComment = await comment.save();
    res.status(201).json(savedComment);

  } catch (err) {
    console.error('Error creating comment:', err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

module.exports = router;