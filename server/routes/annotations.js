const express = require('express');
const Annotation = require('../models/Annotation');
const pool = require('../config/db');
const router = express.Router();


// GET /annotations?media_id=uuid
router.get('/', async (req, res) => {
  const { media_id } = req.query;
  if (!media_id) {
    return res.status(400).json({ error: 'media_id is required' });
  }

  try {
    const annotations = await Annotation.find({ mediaId: media_id })
      .sort({ createdAt: 1 })
      .lean();
    res.json(annotations);
  } catch (err) {
    console.error('Error fetching annotations:', err);
    res.status(500).json({ error: 'Failed to fetch annotations' });
  }
});

// POST /annotations
router.post('/', async (req, res) => {
  const { media_id, user_id, type, coordinates, timestamp, text } = req.body;
  if (!media_id || !user_id || coordinates?.x === undefined || coordinates?.y === undefined) {
    return res.status(400).json({ error: 'media_id, user_id and coordinates are required' });
  }

  try {
    // Query user from Postgres
    const userRes = await pool.query('SELECT username FROM users WHERE id = $1', [user_id]);
    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid user_id' });
    }
    const username = userRes.rows[0].username;

    const annotationData = {
      mediaId: media_id,
      userId: user_id,
      username,
      type: type || 'point',
      coordinates,
      text,
    };

    if (timestamp !== undefined && timestamp >= 0) {
      annotationData.timestamp = timestamp;
    }

    const annotation = new Annotation(annotationData);
    const savedAnnotation = await annotation.save();
    res.status(201).json(savedAnnotation);

  } catch (err) {
    console.error('Error creating annotation:', err);
    res.status(500).json({ error: 'Failed to create annotation' });
  }
});

// GET annotations by timestamp range (for video scrubbing)
router.get('/timeline/:media_id', async (req, res) => {
  const { media_id } = req.params;
  const { start, end } = req.query;

  try {
    const query = { 
      mediaId: media_id,
      timestamp: { $exists: true }
    };

    if (start !== undefined && end !== undefined) {
      query.timestamp = { 
        $gte: parseFloat(start), 
        $lte: parseFloat(end) 
      };
    }

    const annotations = await Annotation.find(query)
      .sort({ timestamp: 1 })
      .lean();
    
    res.json(annotations);
  } catch (err) {
    console.error('Error fetching timeline annotations:', err);
    res.status(500).json({ error: 'Failed to fetch timeline annotations' });
  }
});

module.exports = router;