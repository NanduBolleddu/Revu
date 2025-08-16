const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// Grant permission
router.post('/', async (req, res) => {
  const { user_id, media_id, can_edit, can_view } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO permissions (user_id, media_id, can_edit, can_view) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, media_id, can_edit, can_view]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error granting permission' });
  }
});

// Get permissions for a media file
router.get('/:media_id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM permissions WHERE media_id = $1',
      [req.params.media_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching permissions' });
  }
});

module.exports = router;
