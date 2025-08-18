const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');

// GET /invitations/accept/:token
router.get('/accept/:token', async (req, res) => {
  const { token } = req.params;
  const userId = req.user.id; // Assume authenticated user ID from middleware

  try {
    const invitation = await pool.query(
      'SELECT * FROM invitations WHERE token = $1 AND status = $2',
      [token, 'pending']
    );
    if (invitation.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }
    const inv = invitation.rows[0];

    if (inv.invited_user_id !== userId) {
      return res.status(403).json({ error: 'Invitation not for this user' });
    }

    // Add to organization_users
    await pool.query(
      `INSERT INTO organization_users (organization_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [inv.organization_id, userId, inv.invited_role]
    );

    // Update status
    await pool.query(
      'UPDATE invitations SET status = $1 WHERE token = $2',
      ['accepted', token]
    );

    // Add to Keycloak organization with role
    try {
      const accessToken = await getKeycloakAdminToken();
      await axios.post(
        `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'revu'}/organizations/${inv.organization_id}/members`,
        {
          userId: inv.invited_user_id,
          roles: [inv.invited_role],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('User added to Keycloak organization with role:', { userId, role: inv.invited_role });
    } catch (kcErr) {
      console.warn('Keycloak membership addition failed:', kcErr.message);
    }

    res.status(200).json({ message: 'Invitation accepted' });
  } catch (err) {
    console.error('Error accepting invitation:', err.message);
    res.status(500).json({ error: 'Error accepting invitation', detail: err.message });
  }
});

module.exports = router;