const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { validate: isUuid } = require('uuid');

// GET /organizations/user/:userId - Get all organizations user is part of
router.get('/user/:userId', async (req, res) => {
  const { userId } = req.params;
  
  if (!isUuid(userId)) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    const result = await pool.query(`
      SELECT 
        o.id,
        o.name,
        o.keycloak_org_id,
        o.created_at,
        ou.role,
        ou.joined_at,
        u_owner.username as owner_username,
        u_owner.email as owner_email,
        (SELECT COUNT(*) FROM organization_users WHERE organization_id = o.id) as member_count
      FROM organizations o
      INNER JOIN organization_users ou ON o.id = ou.organization_id
      INNER JOIN users u_owner ON o.owner_user_id = u_owner.id
      WHERE ou.user_id = $1
      ORDER BY ou.role = 'owner' DESC, o.created_at DESC
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user organizations:', err);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// GET /organizations/:orgId/members - Get all members of an organization
router.get('/:orgId/members', async (req, res) => {
    const { orgId } = req.params;
    
    if (!isUuid(orgId)) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }
  
    try {
      const result = await pool.query(`
        SELECT 
          u.id,
          u.username,
          u.email,
          ou.role,
          ou.joined_at,
          u.created_at as user_created_at
        FROM organization_users ou
        INNER JOIN users u ON ou.user_id = u.id
        WHERE ou.organization_id = $1
        ORDER BY ou.role = 'owner' DESC, ou.joined_at ASC
      `, [orgId]);
  
      res.json(result.rows);
    } catch (err) {
      console.error('Error fetching organization members:', err);
      res.status(500).json({ error: 'Failed to fetch organization members' });
    }
  });
  
module.exports = router;
