const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const { validate: isUuid } = require('uuid');

// Helper function to get Keycloak admin token
const getKeycloakAdminToken = async () => {
  try {
    const response = await axios.post(
      `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/realms/master/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'password',
        username: process.env.KEYCLOAK_ADMIN_USER || 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin',
        client_id: 'admin-cli',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.access_token;
  } catch (err) {
    console.error('❌ Failed to obtain Keycloak admin token:', err.message);
    throw new Error(`Failed to obtain Keycloak admin token: ${err.message}`);
  }
};

// Test route
router.get('/test', (req, res) => {
  res.json({ message: 'Org invites route is working!' });
});

// POST /send - Send organization invite
router.post('/send', async (req, res) => {
  const { invited_user_id, invited_by, message } = req.body;
  if (!invited_user_id || !invited_by) {
    return res.status(400).json({ error: 'invited_user_id and invited_by are required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Lookup inviter
    const inviterUserResult = await client.query('SELECT id FROM users WHERE keycloak_id = $1', [invited_by]);
    if (inviterUserResult.rows.length === 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(404).json({ error: 'Inviter user not found' });
    }
    const inviterInternalId = inviterUserResult.rows[0].id;

    // Lookup inviter's organization
    const orgResult = await client.query(
      'SELECT id, name, keycloak_org_id FROM organizations WHERE owner_user_id = $1',
      [inviterInternalId]
    );
    if (orgResult.rows.length === 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(404).json({ error: 'Your organization not found' });
    }
    const organization = orgResult.rows[0];

    // Lookup invitee
    const invitedUserResult = await client.query(
      'SELECT id FROM users WHERE keycloak_id = $1',
      [invited_user_id]
    );
    if (invitedUserResult.rows.length === 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(404).json({ error: 'Invited user not found' });
    }
    const invitedUserInternalId = invitedUserResult.rows[0].id;

    // Check if already member
    const memberCheck = await client.query(
      'SELECT id FROM organization_users WHERE organization_id = $1 AND user_id = $2',
      [organization.id, invitedUserInternalId]
    );
    if (memberCheck.rows.length > 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(400).json({ error: 'User is already a member of your organization' });
    }

    // Check if already pending
    const inviteCheck = await client.query(
      "SELECT id FROM organization_invites WHERE organization_id = $1 AND invited_user_id = $2 AND status = 'pending'",
      [organization.id, invitedUserInternalId]
    );
    if (inviteCheck.rows.length > 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(400).json({ error: 'Invitation already sent to this user' });
    }

    // Create invite
    const result = await client.query(
      'INSERT INTO organization_invites (organization_id, invited_user_id, invited_by, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [organization.id, invitedUserInternalId, inviterInternalId, message?.trim() || null]
    );
    
    await client.query('COMMIT'); 
    client.release();

    // Notify via socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${invited_user_id}`).emit('org-invite', {
        from: invited_by,
        organizationName: organization.name,
        message: message,
        inviteId: result.rows[0].id
      });
    }
    
    res.status(201).json({
      message: 'Organization invitation sent successfully',
      invite: result.rows,
      organizationName: organization.name
    });

  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Error sending org invitation:', err);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// GET /pending/:userId - Get pending invites for user (internal UUID)
router.get('/pending/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!isUuid(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  
  try {
    const result = await pool.query(`
      SELECT oi.*, o.name as organization_name, u.username as invited_by_username
      FROM organization_invites oi
      INNER JOIN organizations o ON oi.organization_id = o.id
      INNER JOIN users u ON oi.invited_by = u.id
      WHERE oi.invited_user_id = $1 AND oi.status = 'pending'
      ORDER BY oi.created_at DESC
    `, [userId]);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching pending invites:', err);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// POST /accept/:inviteId - Accept organization invite with Keycloak integration
router.post('/accept/:inviteId', async (req, res) => {
  const { inviteId } = req.params;
  if (!isUuid(inviteId)) {
    return res.status(400).json({ error: 'Invalid invite ID' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get invitation details with organization and Keycloak org ID
    const inviteResult = await client.query(`
      SELECT oi.*, o.name as organization_name, o.keycloak_org_id
      FROM organization_invites oi
      INNER JOIN organizations o ON oi.organization_id = o.id
      WHERE oi.id = $1 AND oi.status = 'pending'
    `, [inviteId]);
    
    if (inviteResult.rows.length === 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }
    const invite = inviteResult.rows[0];

    // Get invited user's keycloak_id
    const userResult = await client.query(
      'SELECT keycloak_id, username FROM users WHERE id = $1',
      [invite.invited_user_id]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK'); 
      client.release();
      return res.status(404).json({ error: 'User not found' });
    }
    const invitedUserKeycloakId = userResult.rows[0].keycloak_id;
    const invitedUserUsername = userResult.rows.username;

    // Add user to organization in local database
    await client.query(
      'INSERT INTO organization_users (organization_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)',
      [invite.organization_id, invite.invited_user_id, 'viewer', invite.invited_by]
    );

    // Update invite status
    await client.query(
      'UPDATE organization_invites SET status = \'accepted\', updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [inviteId]
    );
    
    await client.query('COMMIT'); 
    client.release();

    // Add user to Keycloak organization using invite-existing-user API
    if (invite.keycloak_org_id && invitedUserKeycloakId) {
      try {
        const accessToken = await getKeycloakAdminToken();
        
        // Use form data for the invite-existing-user endpoint
        const formData = new URLSearchParams();
        formData.append('id', invitedUserKeycloakId);
        
        await axios.post(
          `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'revu'}/organizations/${invite.keycloak_org_id}/members/invite-existing-user`,
          formData,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        
        console.log('✅ User added to Keycloak organization via invite-existing-user:', {
          keycloakId: invitedUserKeycloakId,
          username: invitedUserUsername,
          orgId: invite.keycloak_org_id
        });
        
      } catch (kcErr) {
        console.warn('⚠️ Failed to add user to Keycloak organization:', {
          error: kcErr.message,
          response: kcErr.response?.data,
          status: kcErr.response?.status,
          keycloakId: invitedUserKeycloakId
        });
        // Don't fail the entire operation if Keycloak fails
      }
    }
    
    console.log('✅ Invitation accepted:', inviteId);
    
    res.json({ 
      message: 'Invitation accepted successfully',
      organizationName: invite.organization_name
    });

  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Error accepting invitation:', err);
    res.status(500).json({ error: 'Failed to accept invitation' });
  }
});

// POST /reject/:inviteId - Reject organization invite
router.post('/reject/:inviteId', async (req, res) => {
  const { inviteId } = req.params;
  if (!isUuid(inviteId)) {
    return res.status(400).json({ error: 'Invalid invite ID' });
  }
  
  try {
    const result = await pool.query(`
      UPDATE organization_invites SET status = 'rejected', updated_at = CURRENT_TIMESTAMP 
      WHERE id = $1 AND status = 'pending' RETURNING *
    `, [inviteId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invitation not found or already processed' });
    }
    
    console.log('✅ Invitation rejected:', inviteId);
    res.json({ message: 'Invitation rejected successfully' });

  } catch (err) {
    console.error('❌ Error rejecting invitation:', err);
    res.status(500).json({ error: 'Failed to reject invitation' });
  }
});

module.exports = router;
