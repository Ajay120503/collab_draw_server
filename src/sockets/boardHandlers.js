const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Board = require('../models/Board');
const Element = require('../models/Element');

// In-memory presence tracking: boardId -> Map<socketId, {userId, name, color, cursor}>
const presenceMap = new Map();

function getPresence(boardId) {
  const boardPresence = presenceMap.get(boardId);
  if (!boardPresence) return [];
  const users = [];
  const seen = new Set();
  for (const entry of boardPresence.values()) {
    if (!seen.has(entry.userId)) {
      seen.add(entry.userId);
      users.push(entry);
    }
  }
  return users;
}

function broadcastPresence(io, boardId) {
  const users = getPresence(boardId);
  io.to(boardId).emit('presence:update', { users });
}

function setupBoardHandlers(io, socket) {
  // Validate and join board room
  socket.on('board:join', async ({ boardId }) => {
    try {
      const decoded = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      if (!user) {
        socket.emit('error', { message: 'Authentication failed' });
        return;
      }

      const board = await Board.findById(boardId);
      if (!board) {
        socket.emit('error', { message: 'Board not found' });
        return;
      }

      // Check authorization
      const isOwner = board.ownerId.toString() === user._id.toString();
      const isCollaborator = board.collaborators.some(
        (c) => c.userId.toString() === user._id.toString()
      );

      if (!isOwner && !isCollaborator && board.visibility === 'private') {
        socket.emit('error', { message: 'Access denied' });
        return;
      }

      socket.join(boardId);
      socket.boardId = boardId;
      socket.userId = user._id;
      socket.userName = user.username;
      socket.userColor = user.avatarColor;

      // Track presence
      if (!presenceMap.has(boardId)) {
        presenceMap.set(boardId, new Map());
      }
      presenceMap.get(boardId).set(socket.id, {
        userId: user._id,
        name: user.username,
        color: user.avatarColor,
        cursor: { x: 0, y: 0 },
        activity: 'idle',
        selectedElementId: null,
      });

      // Send initial state
      const elements = await Element.find({ boardId }).sort({ zIndex: 1 });
      const presentUsers = getPresence(boardId);
      socket.emit('board:state', { elements, presentUsers });

      // Broadcast updated presence
      broadcastPresence(io, boardId);
    } catch (error) {
      console.error('board:join error:', error);
      socket.emit('error', { message: 'Failed to join board' });
    }
  });

  // Cursor move with activity tracking
  socket.on('cursor:move', ({ x, y, activity, selectedElementId }) => {
    const { boardId } = socket;
    if (!boardId) return;

    const boardPresence = presenceMap.get(boardId);
    if (boardPresence && boardPresence.has(socket.id)) {
      const entry = boardPresence.get(socket.id);
      entry.cursor = { x, y };
      if (activity) entry.activity = activity;
      if (selectedElementId !== undefined) entry.selectedElementId = selectedElementId;
    }

    socket.to(boardId).emit('cursor:move', {
      userId: socket.userId,
      name: socket.userName,
      color: socket.userColor,
      x,
      y,
      activity,
    });
  });

  // Element operations
  socket.on('element:add', async (elementData) => {
    const { boardId } = socket;
    if (!boardId) return;

    try {
      // Get max zIndex
      const maxElement = await Element.findOne({ boardId }).sort({ zIndex: -1 });
      const zIndex = (maxElement?.zIndex || 0) + 1;

      const element = await Element.create({
        boardId,
        type: elementData.type,
        attrs: elementData.attrs,
        zIndex: elementData.zIndex || zIndex,
        createdBy: socket.userId,
        updatedBy: socket.userId,
      });

      socket.to(boardId).emit('element:add', element);
      socket.emit('element:add', element); // echo back with _id
    } catch (error) {
      console.error('element:add error:', error);
      socket.emit('error', { message: 'Failed to add element' });
    }
  });

  socket.on('element:update', async ({ id, changes }) => {
    const { boardId } = socket;
    if (!boardId) return;

    try {
      const element = await Element.findById(id);
      if (!element || element.boardId.toString() !== boardId) return;

      // Merge changes into attrs
      if (changes.attrs) {
        element.attrs = { ...element.attrs, ...changes.attrs };
        element.markModified('attrs');
      }
      if (changes.zIndex !== undefined) element.zIndex = changes.zIndex;
      element.updatedBy = socket.userId;
      element.version += 1;
      await element.save();

      io.to(boardId).emit('element:update', { id, changes, updatedBy: socket.userId });
    } catch (error) {
      console.error('element:update error:', error);
    }
  });

  socket.on('element:delete', async ({ id }) => {
    const { boardId } = socket;
    if (!boardId) return;

    try {
      const element = await Element.findById(id);
      if (!element || element.boardId.toString() !== boardId) return;

      await Element.findByIdAndDelete(id);
      io.to(boardId).emit('element:delete', { id });
    } catch (error) {
      console.error('element:delete error:', error);
    }
  });

  // Undo/Redo - broadcast the intention; each client maintains its own stack
  socket.on('board:undo', ({ targetId }) => {
    const { boardId } = socket;
    if (boardId) socket.to(boardId).emit('board:undo', { targetId });
  });

  socket.on('board:redo', ({ targetId }) => {
    const { boardId } = socket;
    if (boardId) socket.to(boardId).emit('board:redo', { targetId });
  });

  // Handle disconnect
  socket.on('board:leave', ({ boardId: leaveBoardId }) => {
    const bid = leaveBoardId || socket.boardId;
    if (bid) {
      const boardPresence = presenceMap.get(bid);
      if (boardPresence) {
        boardPresence.delete(socket.id);
        if (boardPresence.size === 0) presenceMap.delete(bid);
      }
      socket.leave(bid);
      broadcastPresence(io, bid);
    }
  });

  socket.on('disconnect', () => {
    const { boardId } = socket;
    if (boardId) {
      const boardPresence = presenceMap.get(boardId);
      if (boardPresence) {
        boardPresence.delete(socket.id);
        if (boardPresence.size === 0) presenceMap.delete(boardId);
      }
      broadcastPresence(io, boardId);
    }
  });
}

module.exports = { setupBoardHandlers };
