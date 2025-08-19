const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const axios = require('axios');
const { validate: isUuid } = require('uuid');

// Helper function to retry a promise-based action
const retry = async (fn, retries = 3, delay = 500) => {
  try {
    return await fn();
  } catch (err) {
    if (retries > 0) {
      console.log(`Attempt failed, retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(res => setTimeout(res, delay));
      return retry(fn, retries - 1, delay);
    } else {
      throw err;
    }
  }
};

// Function to sanitize organization name (remove spaces and special characters)
const sanitizeOrgName = (name) => name.replace(/\s+/g, '-').toLowerCase();

// Function to generate a unique domain (e.g., based on orgName)
const generateDomain = (orgName) => `${orgName}.org`; // Example: org-of-demo19.org

const getKeycloakAdminToken = async () => {
  try {
    const response = await axios.post(
      `http://localhost:8080/realms/master/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'password',
        username: process.env.KEYCLOAK_ADMIN_USER || 'admin',
        password: process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin',
        client_id: 'admin-cli',
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    console.log('✅ Keycloak admin token obtained successfully');
    return response.data.access_token;
  } catch (err) {
    console.error('❌ Failed to obtain Keycloak admin token:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
      clientId: process.env.KEYCLOAK_ADMIN_USER || 'admin',
      keycloakUrl: process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080',
    });
    throw new Error(`Failed to obtain Keycloak admin token: ${err.message}`);
  }
};

// Function to check if user exists in Keycloak by their ID
const checkUserExists = async (accessToken, keycloakId) => {
  try {
    await axios.get(
      `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'revu'}/users/${keycloakId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    // If the request succeeds (status 200), the user exists.
    return true;
  } catch (err) {
    // A 404 status specifically means the user does not exist.
    if (err.response && err.response.status === 404) {
      return false;
    }
    // For other errors, log a warning but assume they don't exist to be safe.
    console.warn('Error checking user existence in Keycloak:', {
      message: err.message,
      status: err.response?.status,
    });
    return false;
  }
};

// GET /users?keycloak_id=<id>
router.get('/', async (req, res) => {
  const { keycloak_id } = req.query;
  try {
    if (keycloak_id && !isUuid(keycloak_id)) {
      console.warn('Invalid keycloak_id:', keycloak_id);
      return res.status(400).json({ error: 'Invalid keycloak_id: Must be a valid UUID' });
    }
    let query = 'SELECT * FROM users';
    let params = [];
    if (keycloak_id) {
      query += ' WHERE keycloak_id = $1';
      params.push(keycloak_id);
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err.message, err.stack);
    res.status(500).json({ error: 'Error fetching users', detail: err.message });
  }
});

// POST /users
router.post('/', async (req, res) => {
  const { keycloak_id, username, email, role } = req.body;

  // Validate required fields and UUID
  if (!keycloak_id || !username || !email) {
    console.warn('Invalid request:', { keycloak_id, username, email });
    return res.status(400).json({ error: 'Missing required fields: keycloak_id, username, email' });
  }
  if (!isUuid(keycloak_id)) {
    console.warn('Invalid keycloak_id:', keycloak_id);
    return res.status(400).json({ error: 'Invalid keycloak_id: Must be a valid UUID' });
  }

  let userId;
  let orgIdInDb;
  let kcOrgId = null;

  try {
    console.log('Starting user registration:', { keycloak_id, username });
    await pool.query('BEGIN');

    // Create or update user
    const userRes = await pool.query(
      `INSERT INTO users (keycloak_id, username, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (keycloak_id)
       DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, role = EXCLUDED.role, updated_at = CURRENT_TIMESTAMP
       RETURNING id, username`,
      [keycloak_id, username, email, role || 'user']
    );
    userId = userRes.rows[0].id;
    console.log('User created/updated:', { userId });

    // Define and sanitize orgName
    const orgName = sanitizeOrgName(`org-of-${username}`);
    const domain = generateDomain(orgName); // e.g., org-of-demo19.org

    // Create organization in Keycloak using Admin REST API
    try {
      const accessToken = await getKeycloakAdminToken();
      const orgResponse = await axios.post(
        `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'revu'}/organizations`,
        {
          name: orgName,
          domains: [domain],
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('Organization creation response:', {
        status: orgResponse.status,
        data: orgResponse.data,
        headers: orgResponse.headers,
      });

      // Handle response: Check for 201 and extract ID from Location header if data is empty
      if (orgResponse.status === 201) {
        if (orgResponse.data && orgResponse.data.id) {
          kcOrgId = orgResponse.data.id;
        } else if (orgResponse.headers.location) {
          const locationParts = orgResponse.headers.location.split('/');
          kcOrgId = locationParts[locationParts.length - 1];
        }
        if (!kcOrgId) {
          throw new Error('Failed to extract organization ID from response');
        }
        console.log('Keycloak organization created:', { orgId: kcOrgId });

        // Check if user exists before adding as owner
        const userExists = await checkUserExists(accessToken, keycloak_id);
        if (!userExists) {
          console.warn('User does not exist in Keycloak, skipping membership assignment:', { keycloak_id });
        } else {
          // Add user as OWNER in Keycloak
          await axios.post(
            `${process.env.KEYCLOAK_SERVER_URL || 'http://localhost:8080'}/admin/realms/${process.env.KEYCLOAK_REALM || 'revu'}/organizations/${kcOrgId}/members`,
            
              keycloak_id,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          console.log('User added as member in Keycloak:', { keycloak_id, orgId: kcOrgId });
        }
      } else {
        throw new Error(`Unexpected status code: ${orgResponse.status}`);
      }
    } catch (kcErr) {
      console.warn('Keycloak organization creation or membership failed, proceeding with DB only:', {
        message: kcErr.message,
        response: kcErr.response?.data,
        status: kcErr.response?.status,
        stack: kcErr.stack,
      });
      // Continue to allow DB updates
    }

    // Insert organization in PostgreSQL
    const orgDbRes = await pool.query(
      `INSERT INTO organizations (name, owner_user_id)
       VALUES ($1, $2) RETURNING id`,
      [orgName, userId]
    );
    orgIdInDb = orgDbRes.rows[0].id;
    console.log('PostgreSQL organization created:', { orgId: orgIdInDb });

    // Insert user as owner in organization_users
    await pool.query(
      `INSERT INTO organization_users (organization_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [orgIdInDb, userId, 'owner']
    );
    console.log('User added to organization_users:', { userId, orgId: orgIdInDb });

    await pool.query('COMMIT');
    console.log('Transaction committed for user:', { keycloak_id });

    res.status(201).json({
      userId,
      organizationId: orgIdInDb,
      keycloakOrgId: kcOrgId || null,
      message: 'User and organization registered successfully',
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error registering user/org:', err.message, err.stack);
    res.status(500).json({ error: 'User registration/org creation failed', detail: err.message });
  }
});

module.exports = router;