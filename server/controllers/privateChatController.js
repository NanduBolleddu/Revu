const Chat = require('../models/Chat');
const ChatMessage = require('../models/ChatMessage');
const UserStatus = require('../models/UserStatus');

// In-memory store for active users and their socket connections
const activeUsers = new Map(); // userId -> { socketId, userData }
let io; // Socket.IO instance

const setSocketInstance = (socketInstance) => {
  io = socketInstance;
};

// Get or create a chat between two users
const getOrCreateChat = async (user1Id, user2Id, user1Data, user2Data) => {
  try {
    // Find existing chat
    let chat = await Chat.findOne({
      $and: [
        { 'participants.userId': user1Id },
        { 'participants.userId': user2Id }
      ]
    });

    if (!chat) {
      // Create new chat
      chat = new Chat({
        participants: [
          {
            userId: user1Id,
            username: user1Data.username,
            avatar: user1Data.avatar
          },
          {
            userId: user2Id,
            username: user2Data.username,
            avatar: user2Data.avatar
          }
        ]
      });
      await chat.save();
    }

    return chat;
  } catch (error) {
    console.error('Error getting or creating chat:', error);
    throw error;
  }
};

// Update user online status
const updateUserStatus = async (userId, username, avatar, isOnline, socketId = null) => {
  try {
    await UserStatus.findOneAndUpdate(
      { userId },
      {
        username,
        avatar,
        isOnline,
        lastSeen: new Date(),
        socketId: isOnline ? socketId : null,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );

    // Broadcast status update to all connected users
    if (io) {
      io.emit('user_status_update', {
        userId,
        username,
        avatar,
        isOnline,
        lastSeen: new Date()
      });
    }
  } catch (error) {
    console.error('Error updating user status:', error);
  }
};

// Handle private chat connections
const handlePrivateChatConnection = (socket) => {
  console.log(`💬 Private chat user connected: ${socket.id}`);

  // User joins private chat
  socket.on('join_private_chat', async ({ userId, username, avatar }) => {
    try {
      // Add user to active users
      activeUsers.set(userId, {
        socketId: socket.id,
        username,
        avatar,
        userId
      });

      // Join user to their personal room
      socket.join(`user_${userId}`);

      // Update user status to online
      await updateUserStatus(userId, username, avatar, true, socket.id);

      console.log(`✅ ${username} joined private chat`);
      
      socket.emit('join_success', { message: 'Successfully joined private chat' });

    } catch (error) {
      console.error('Error joining private chat:', error);
      socket.emit('join_error', { message: 'Failed to join private chat' });
    }
  });

  // Send private message
  socket.on('send_private_message', async ({ 
    senderId, 
    senderUsername, 
    receiverId, 
    message, 
    avatar 
  }) => {
    try {
      if (!message || !message.trim()) {
        return socket.emit('message_error', { message: 'Message cannot be empty' });
      }

      if (message.trim().length > 1000) {
        return socket.emit('message_error', { message: 'Message too long (max 1000 characters)' });
      }

      // Get receiver data
      const receiverStatus = await UserStatus.findOne({ userId: receiverId });
      if (!receiverStatus) {
        return socket.emit('message_error', { message: 'Receiver not found' });
      }

      // Get or create chat
      const chat = await getOrCreateChat(
        senderId, 
        receiverId,
        { username: senderUsername, avatar },
        { username: receiverStatus.username, avatar: receiverStatus.avatar }
      );

      // Create and save message
      const chatMessage = new ChatMessage({
        chatId: chat._id,
        senderId,
        senderUsername,
        receiverId,
        message: message.trim(),
        messageType: 'text'
      });

      await chatMessage.save();

      // Update chat's last message
      chat.lastMessage = {
        senderId,
        text: message.trim(),
        timestamp: new Date(),
        messageType: 'text'
      };
      chat.updatedAt = new Date();
      await chat.save();

      console.log(`💬 Private message from ${senderUsername} to ${receiverStatus.username}: ${message.trim()}`);

      const messageData = {
        _id: chatMessage._id,
        chatId: chat._id,
        senderId: chatMessage.senderId,
        senderUsername: chatMessage.senderUsername,
        receiverId: chatMessage.receiverId,
        message: chatMessage.message,
        messageType: chatMessage.messageType,
        createdAt: chatMessage.createdAt
      };

      // Send message to both sender and receiver
      socket.emit('new_private_message', messageData);
      socket.to(`user_${receiverId}`).emit('new_private_message', messageData);

      // Send chat list update to both users
      const senderChats = await getUserChats(senderId);
      const receiverChats = await getUserChats(receiverId);

      socket.emit('chat_list_update', senderChats);
      socket.to(`user_${receiverId}`).emit('chat_list_update', receiverChats);

    } catch (error) {
      console.error('Error sending private message:', error);
      socket.emit('message_error', { message: 'Failed to send message' });
    }
  });

  // Start typing indicator
  socket.on('typing_start', ({ senderId, receiverId, senderUsername }) => {
    socket.to(`user_${receiverId}`).emit('user_typing', { 
      senderId, 
      senderUsername, 
      isTyping: true 
    });
  });

  // Stop typing indicator
  socket.on('typing_stop', ({ senderId, receiverId, senderUsername }) => {
    socket.to(`user_${receiverId}`).emit('user_typing', { 
      senderId, 
      senderUsername, 
      isTyping: false 
    });
  });

  // Mark messages as read
  socket.on('mark_messages_read', async ({ chatId, userId }) => {
    try {
      await ChatMessage.updateMany(
        { 
          chatId: chatId,
          receiverId: userId,
          'readBy.userId': { $ne: userId }
        },
        {
          $push: {
            readBy: {
              userId: userId,
              readAt: new Date()
            }
          }
        }
      );

      // Notify sender about read receipt
      const chat = await Chat.findById(chatId);
      if (chat) {
        const otherParticipant = chat.participants.find(p => p.userId !== userId);
        if (otherParticipant) {
          socket.to(`user_${otherParticipant.userId}`).emit('messages_read', { 
            chatId, 
            readBy: userId 
          });
        }
      }

    } catch (error) {
      console.error('Error marking messages as read:', error);
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    // Find user by socket ID
    let disconnectedUser = null;
    for (const [userId, userData] of activeUsers.entries()) {
      if (userData.socketId === socket.id) {
        disconnectedUser = { userId, ...userData };
        activeUsers.delete(userId);
        break;
      }
    }

    if (disconnectedUser) {
      console.log(`👋 ${disconnectedUser.username} left private chat`);
      
      // Update user status to offline
      await updateUserStatus(
        disconnectedUser.userId, 
        disconnectedUser.username, 
        disconnectedUser.avatar, 
        false
      );
    }
  });
};

// Get user's chat list
const getUserChats = async (userId) => {
  try {
    const chats = await Chat.find({
      'participants.userId': userId
    })
    .sort({ updatedAt: -1 })
    .lean();

    // Get online status for all participants
    const participantIds = chats.flatMap(chat => 
      chat.participants.map(p => p.userId)
    ).filter(id => id !== userId);

    const userStatuses = await UserStatus.find({
      userId: { $in: participantIds }
    }).lean();

    const statusMap = new Map();
    userStatuses.forEach(status => {
      statusMap.set(status.userId, status);
    });

    // Add status info to chats
    return chats.map(chat => {
      const otherParticipant = chat.participants.find(p => p.userId !== userId);
      const status = statusMap.get(otherParticipant.userId);
      
      return {
        ...chat,
        otherParticipant: {
          ...otherParticipant,
          isOnline: status?.isOnline || false,
          lastSeen: status?.lastSeen || otherParticipant.lastSeen
        }
      };
    });
  } catch (error) {
    console.error('Error getting user chats:', error);
    return [];
  }
};

module.exports = {
  handlePrivateChatConnection,
  setSocketInstance,
  getUserChats,
  getOrCreateChat
};
