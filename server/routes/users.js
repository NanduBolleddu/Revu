const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// Create user
router.post('/', async (req, res) => {
  const { keycloak_id, username, email, role } = req.body;

  try {
    const result = await pool.query(
      'INSERT INTO users (keycloak_id, username, email, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [keycloak_id, username, email, role]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creating user' });
  }
});

// Get users - support filtering by keycloak_id
router.get('/', async (req, res) => {
  const { keycloak_id } = req.query;

  try {
    let query = 'SELECT * FROM users';
    let params = [];

    if (keycloak_id) {
      query += ' WHERE keycloak_id = $1';
      params.push(keycloak_id);
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching users' });
  }
});

module.exports = router;
