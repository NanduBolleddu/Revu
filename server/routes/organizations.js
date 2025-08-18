const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const crypto = require('crypto');

// POST /organizations/:orgId/invite
router.post('/:orgId/invite', async (req, res) => {
  const { orgId } = req.params;
  const { invited_email, invited_role } = req.body;
  const invited_by = req.user.id; // Assume authenticated user ID from middleware

  if (!invited_email || !invited_role || !['reviewer', 'viewer'].includes(invited_role)) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  try {
    // Check if owner
    const orgCheck = await pool.query(
      'SELECT owner_user_id FROM organizations WHERE id = $1',
      [orgId]
    );
    if (orgCheck.rows.length === 0 || orgCheck.rows[0].owner_user_id !== invited_by) {
      return res.status(403).json({ error: 'You are not the owner of this organization' });
    }

    // Find invited user by email
    const invitedUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [invited_email]
    );
    if (invitedUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const invited_user_id = invitedUser.rows[0].id;

    // Generate token
    const token = crypto.randomBytes(32).toString('hex');

    // Insert invitation
    await pool.query(
      `INSERT INTO invitations (organization_id, invited_user_id, invited_email, invited_role, invited_by, token)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [orgId, invited_user_id, invited_email, invited_role, invited_by, token]
    );

    // Generate invitation link
    const invitationLink = `http://localhost:3000/invite/accept/${token}`;

    res.status(201).json({
      message: 'Invitation created',
      invitationLink,
      token,
    });
  } catch (err) {
    console.error('Error creating invitation:', err.message);
    res.status(500).json({ error: 'Error creating invitation', detail: err.message });
  }
});

module.exports = router;