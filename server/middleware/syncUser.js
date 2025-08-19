// server/middleware/syncUser.js
const pool = require('../config/db');

async function syncUser(req, res, next) {
  try {
    // requires keycloak.protect() to have run
    const token = req.kauth?.grant?.access_token?.content;
    if (!token) return res.status(401).json({ error: 'No token on request' });

    const keycloakId = token.sub;
    const username = token.preferred_username || token.name || '';
    const email = token.email || '';
    // pick your own role mapping; default to 'user'
    const role =
      (token.realm_access && token.realm_access.roles && token.realm_access.roles[0]) ||
      'user';

    // upsert the user into local users table
    const existing = await pool.query('SELECT id FROM users WHERE keycloak_id = $1', [
      keycloakId,
    ]);

    if (existing.rows.length === 0) {
      console.log('User not found in DB, skipping insert (handled by POST /users)');
    } else {
      await pool.query(
        `UPDATE users
           SET username = $2,
               email = $3,
               role = $4,
               updated_at = CURRENT_TIMESTAMP
         WHERE keycloak_id = $1`,
        [keycloakId, username, email, role]
      );
    }

    next();
  } catch (err) {
    console.error('Error syncing user:', err);
    res.status(500).json({ error: 'User sync failed' });
  }
}

module.exports = syncUser;