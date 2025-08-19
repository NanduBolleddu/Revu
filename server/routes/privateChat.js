const express = require('express');
const Chat = require('../models/Chat');
const ChatMessage = require('../models/ChatMessage');
const UserStatus = require('../models/UserStatus');
const { getUserChats } = require('../controllers/privateChatController');

const router = express.Router();

// Get user's chat list
router.get('/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const chats = await getUserChats(userId);
    res.json(chats);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

// Get messages for a specific chat
router.get('/messages/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const messages = await ChatMessage.find({ chatId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const totalMessages = await ChatMessage.countDocuments({ chatId });
    const hasMore = skip + messages.length < totalMessages;

    res.json({
      messages: messages.reverse(), // Show oldest first
      hasMore,
      totalMessages,
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get all users for starting new chats
router.get('/users/:currentUserId', async (req, res) => {
  try {
    const { currentUserId } = req.params;
    
    // Get all user statuses except current user
    const users = await UserStatus.find({
      userId: { $ne: currentUserId }
    })
    .sort({ username: 1 })
    .lean();

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Search users
router.get('/users/search/:currentUserId', async (req, res) => {
  try {
    const { currentUserId } = req.params;
    const { q } = req.query;

    if (!q || q.trim().length < 2) {
      return res.json([]);
    }

    const users = await UserStatus.find({
      userId: { $ne: currentUserId },
      username: { $regex: q.trim(), $options: 'i' }
    })
    .limit(10)
    .sort({ username: 1 })
    .lean();

    res.json(users);
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

module.exports = router;