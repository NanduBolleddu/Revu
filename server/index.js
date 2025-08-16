const express = require('express');
const http = require('http');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

// MongoDB connection
const connectMongoDB = require('./config/mongodb');
connectMongoDB();

const pool = require('./config/db'); // PostgreSQL for user/media metadata
const { initKeycloak, memoryStore } = require('./middleware/keycloak');

// Import controllers
const { handlePrivateChatConnection, setSocketInstance } = require('./controllers/privateChatController');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Initialize Keycloak
const keycloak = initKeycloak();
app.use(session({
  secret: 'someSecret',
  resave: false,
  saveUninitialized: true,
  store: memoryStore
}));
app.use(keycloak.middleware());

// Set socket instance for chat controller
setSocketInstance(io);

// Import routes
const usersRoutes = require('./routes/users');
const mediaRoutes = require('./routes/media');
const permissionsRoutes = require('./routes/permissions');
const commentsRoutes = require('./routes/comments');
const annotationsRoutes = require('./routes/annotations');
const privateChatRoutes = require('./routes/privateChat'); // Add private chat routes

app.use('/users', usersRoutes);
app.use('/media', mediaRoutes);
app.use('/permissions', permissionsRoutes);
app.use('/comments', commentsRoutes);
app.use('/annotations', annotationsRoutes);
app.use('/private-chat', privateChatRoutes); // Add private chat routes
app.use('/uploads', express.static('uploads'));

// Socket.IO logic
io.on('connection', (socket) => {
  console.log('🔗 User connected:', socket.id);

  // Handle private chat connections
  handlePrivateChatConnection(socket);

  // Existing media-related socket handlers
  socket.on('join-media', (mediaId) => {
    socket.join(mediaId);
    console.log(`📺 User ${socket.id} joined media room: ${mediaId}`);
  });

  socket.on('new-comment', ({ mediaId, comment }) => {
    console.log('💬 Broadcasting comment to room:', mediaId);
    socket.to(mediaId).emit('new-comment', comment);
  });

  socket.on('new-annotation', ({ mediaId, annotation }) => {
    console.log('📍 Broadcasting annotation to room:', mediaId);
    socket.to(mediaId).emit('new-annotation', annotation);
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
  });
});

// Basic routes
app.get('/', (req, res) => {
  res.json({
    message: "REVU API Server",
    status: "Running",
    features: ["Real-time Comments", "Annotations", "Socket.IO", "Private Chat"]
  });
});

app.get('/db-test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      postgresql: result.rows[0],
      mongodb: 'Connected ✅',
      socketio: 'Ready ✅'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('DB query failed');
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for real-time features`);
  console.log(`💬 Private chat system ready for 1-on-1 messaging`);
});
