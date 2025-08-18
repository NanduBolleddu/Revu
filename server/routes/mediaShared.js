const express = require('express');
const pool = require('../config/db');
const router = express.Router();

// POST /media-shared/share
router.post('/share', async (req, res) => {
  const { media_id, shared_by, shared_with, message } = req.body;
  if (!media_id || !shared_by || !shared_with) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    // Check if users are in the same organization
    const orgCheck = await pool.query(
      `SELECT ou1.organization_id
       FROM organization_users ou1
       JOIN organization_users ou2 ON ou1.organization_id = ou2.organization_id
       WHERE ou1.user_id = $1 AND ou2.user_id = $2`,
      [shared_by, shared_with]
    );
    if (orgCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Users must be in the same organization' });
    }
    // Proceed with sharing logic...
  } catch (err) {
    console.error('Error sharing media:', err);
    return res.status(500).json({ error: 'Error sharing media' });
  }
});
router.get('/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
      const result = await pool.query(`
        SELECT m.*, ms.shared_at, ms.message, u.username AS shared_by_username
        FROM media_shared ms
        JOIN media m ON ms.media_id = m.id
        JOIN users u ON ms.shared_by = u.id
        WHERE ms.shared_with = $1
        ORDER BY ms.shared_at DESC
      `, [userId]);
      res.json(result.rows);
    } catch (err) {
      console.error('Error fetching shared media:', err);
      res.status(500).json({ error: 'Error fetching shared media' });
    }
  });
  

  router.post('/:orgId/invite', async (req, res) => {
    const { orgId } = req.params;
    const { user_id, role } = req.body;
    try {
      const orgCheck = await pool.query(
        'SELECT owner_user_id FROM organizations WHERE id = $1',
        [orgId]
      );
      if (orgCheck.rows.length === 0) {
        return res.status(404).json({ error: 'Organization not found' });
      }
      const client = await createKcAdminClient();
      await client.organizations.addMembership({
        orgId,
        userId: user_id,
        membershipType: role.toUpperCase(),
      });
      await pool.query(
        `INSERT INTO organization_users (organization_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, $4)`,
        [orgId, user_id, role, orgCheck.rows[0].owner_user_id]
      );
      res.status(201).json({ message: 'User invited successfully' });
    } catch (err) {
      console.error('Error inviting user:', err);
      res.status(500).json({ error: 'Error inviting user', detail: err.message });
    }
  });
  
module.exports = router;
