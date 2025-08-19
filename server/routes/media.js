const express = require('express');
const pool = require('../config/db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// Upload media file
router.post("/upload", upload.single("file"), async (req, res) => {
  const { title, type, uploaded_by } = req.body;
  
  if (!req.file || !title || !type || !uploaded_by) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  const file_path = `/uploads/${req.file.filename}`;

  try {
    const result = await pool.query(
      `INSERT INTO media (title, type, file_path, uploaded_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, type, file_path, uploaded_by]
    );

    res.status(201).json({
      message: "File uploaded successfully",
      media: result.rows[0]
    });
  } catch (err) {
    console.error("Error saving media record:", err.message);
    res.status(500).json({ 
      error: "Error saving media record", 
      detail: err.message 
    });
  }
});

// Get media for specific user only ✅
router.get('/', async (req, res) => {
  const userId = req.query.userId;

  if (!userId) {
    return res.status(400).json({ 
      error: 'Missing userId parameter. Please provide ?userId=your-user-id' 
    });
  }

  try {
    // Only get media uploaded by this specific user
    // Replace the media query in GET /media with:
const result = await pool.query(
  `SELECT m.*, u.username AS uploaded_by_username
   FROM media m
   JOIN users u ON m.uploaded_by = u.id
   WHERE m.uploaded_by = $1
   ORDER BY m.created_at DESC`,
  [userId]
);
res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching media' });
  }
});

router.get('/upload', (req, res) => {
  res.send("Upload endpoint — use POST with form-data");
});


// Add this to your server/routes/media.js file

// Delete media file
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    // Get the file path before deleting the record
    const result = await pool.query('SELECT file_path FROM media WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Media file not found' });
    }
    
    const filePath = result.rows[0].file_path;
    
    // Delete the database record
    await pool.query('DELETE FROM media WHERE id = $1', [id]);
    
    // Optionally delete the physical file
    const fullPath = path.join(__dirname, '..', filePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    
    res.json({ message: 'Media file deleted successfully' });
  } catch (err) {
    console.error('Error deleting media:', err);
    res.status(500).json({ error: 'Error deleting media file' });
  }
});

// Edit/Update media title
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;

  console.log('PATCH /media/:id called with:', { id, title });

  if (!title || !title.trim()) {
    console.log('Validation failed: Title is required');
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const result = await pool.query(
      'UPDATE media SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
      [title.trim(), id]
    );

    if (result.rows.length === 0) {
      console.log('No media found with id:', id);
      return res.status(404).json({ error: 'Media file not found' });
    }

    console.log('Media updated successfully:', result.rows[0]);
    res.json({
      message: 'Media updated successfully',
      media: result.rows
    });
  } catch (err) {
    console.error('Error updating media:', err.message);
    console.error('Full error:', err);
    res.status(500).json({ error: 'Error updating media file', detail: err.message });
  }
});


module.exports = router;