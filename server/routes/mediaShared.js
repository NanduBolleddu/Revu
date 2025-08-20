const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// POST /media-shared/share - Enhanced sharing with organization check
router.post("/share", async (req, res) => {
  const { media_id, shared_by, shared_with, message } = req.body;

  if (!media_id || !shared_by || !shared_with) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // Check if users are in the same organization and get their roles
    const orgCheck = await pool.query(
      `
      SELECT
        ou1.organization_id,
        ou1.role as sharer_role,
        ou2.role as receiver_role,
        o.name as organization_name
      FROM organization_users ou1
      JOIN organization_users ou2 ON ou1.organization_id = ou2.organization_id
      JOIN organizations o ON ou1.organization_id = o.id
      WHERE ou1.user_id = $1 AND ou2.user_id = $2
    `,
      [shared_by, shared_with]
    );

    if (orgCheck.rows.length === 0) {
      return res
        .status(403)
        .json({
          error: "Users must be in the same organization to share media",
        });
    }

    const orgData = orgCheck.rows[0];

    // Make sure the media belongs to the sharer
    const mediaCheck = await pool.query(
      "SELECT id, title FROM media WHERE id = $1 AND uploaded_by = $2",
      [media_id, shared_by]
    );

    if (mediaCheck.rows.length === 0) {
      return res
        .status(403)
        .json({ error: "You can only share your own media" });
    }

    // Check if the media was already shared with this user
    const existingShare = await pool.query(
      "SELECT id FROM media_shared WHERE media_id = $1 AND shared_with = $2",
      [media_id, shared_with]
    );

    if (existingShare.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "Media already shared with this user" });
    }

    // Assign sharer's organization_id explicitly by fetching from owner role
    const sharerOrgResult = await pool.query(
      `SELECT organization_id FROM organization_users WHERE user_id = $1 AND role = 'owner' LIMIT 1`,
      [shared_by]
    );

    if (sharerOrgResult.rows.length === 0) {
      return res
        .status(403)
        .json({ error: "Sharer does not belong to an organization as owner" });
    }

    const sharerOrganizationId = sharerOrgResult.rows[0].organization_id;

    // Create the share record using permission_level from the receiver's role and sharer's organization_id
    const result = await pool.query(
      `
      INSERT INTO media_shared (media_id, shared_by, shared_with, message, permission_level, organization_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
      [
        media_id,
        shared_by,
        shared_with,
        message?.trim() || null,
        orgData.receiver_role,
        sharerOrganizationId,
      ]
    );

    res.status(201).json({
      message: "Media shared successfully",
      share: result.rows[0],
    });
  } catch (err) {
    console.error("Error sharing media:", err);
    res.status(500).json({ error: "Error sharing media", detail: err.message });
  }
});

// GET /media-shared/:userId - Get shared media with role-based organization info
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Validate userId is a UUID (basic check)
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ error: "Invalid user ID format" });
    }

    // Select shared media including sharer's username and organization name for context
    const result = await pool.query(
      `
      SELECT
        m.*,
        ms.shared_at,
        ms.message,
        ms.permission_level,
        ms.organization_id,
        u_sharer.username AS shared_by_username,
        COALESCE(o.name, 'Unknown Organization') AS organization_name
      FROM media_shared ms
      JOIN media m ON ms.media_id = m.id
      JOIN users u_sharer ON ms.shared_by = u_sharer.id
      LEFT JOIN organizations o ON ms.organization_id = o.id
      WHERE ms.shared_with = $1
      ORDER BY ms.shared_at DESC
    `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching shared media:", err);
    res
      .status(500)
      .json({ error: "Error fetching shared media", detail: err.message });
  }
});

module.exports = router;
