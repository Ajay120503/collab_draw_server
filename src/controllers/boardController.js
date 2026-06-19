const Board = require('../models/Board');
const Element = require('../models/Element');
const { v4: uuidv4 } = require('uuid');

exports.listBoards = async (req, res) => {
  try {
    const owned = await Board.find({ ownerId: req.userId, isTemplate: false })
      .populate('collaborators.userId', 'username email avatarColor')
      .sort({ updatedAt: -1 });

    const shared = await Board.find({
      'collaborators.userId': req.userId,
      ownerId: { $ne: req.userId },
      isTemplate: false,
    })
      .populate('ownerId', 'username email avatarColor')
      .populate('collaborators.userId', 'username email avatarColor')
      .sort({ updatedAt: -1 });

    const templates = await Board.find({
      $or: [
        { ownerId: req.userId, isTemplate: true },
        { 'collaborators.userId': req.userId, isTemplate: true },
      ],
    }).populate('ownerId', 'username email avatarColor');

    // Deduplicate because user can be both owner and collaborator
    const seen = new Set();
    const uniqueTemplates = templates.filter((t) => {
      const key = t._id.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    res.json({ owned, shared, templates: uniqueTemplates });
  } catch (error) {
    console.error('List boards error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.createBoard = async (req, res) => {
  try {
    const { title, fromTemplateId } = req.body;

    if (fromTemplateId) {
      const template = await Board.findById(fromTemplateId);
      if (!template || !template.isTemplate) {
        return res.status(404).json({ message: 'Template not found' });
      }

      const templateElements = await Element.find({ boardId: fromTemplateId });

      const board = await Board.create({
        title: title || `${template.title} (copy)`,
        ownerId: req.userId,
        collaborators: [{ userId: req.userId, role: 'owner' }],
      });

      // Clone elements from template
      const newElements = templateElements.map((el) => ({
        boardId: board._id,
        type: el.type,
        attrs: { ...el.attrs },
        zIndex: el.zIndex,
        createdBy: req.userId,
        updatedBy: req.userId,
      }));

      if (newElements.length > 0) {
        await Element.insertMany(newElements);
      }

      return res.status(201).json({ board });
    }

    // Ensure no duplicate collaborator entry for owner
    const board = await Board.create({
      title: title || 'Untitled Board',
      ownerId: req.userId,
      collaborators: [{ userId: req.userId, role: 'owner' }],
    });

    res.status(201).json({ board });
  } catch (error) {
    console.error('Create board error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getBoard = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id)
      .populate('ownerId', 'username email avatarColor')
      .populate('collaborators.userId', 'username email avatarColor');

    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    // Check access
    const isOwner = board.ownerId._id.toString() === req.userId.toString();
    const isCollaborator = board.collaborators.some(
      (c) => c.userId._id.toString() === req.userId.toString()
    );

    if (!isOwner && !isCollaborator && board.visibility === 'private') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Deduplicate collaborators
    const seen = new Set();
    board.collaborators = board.collaborators.filter((c) => {
      const key = c.userId?._id?.toString() || c.userId?.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Ensure owner entry exists
    if (!seen.has(board.ownerId._id?.toString() || board.ownerId?.toString())) {
      board.collaborators.unshift({ userId: board.ownerId, role: 'owner' });
    }

    const elements = await Element.find({ boardId: board._id }).sort({ zIndex: 1 });

    res.json({ board, elements });
  } catch (error) {
    console.error('Get board error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.updateBoard = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const collaborator = board.collaborators.find(
      (c) => c.userId.toString() === req.userId.toString()
    );
    if (!collaborator || (collaborator.role !== 'owner' && collaborator.role !== 'editor')) {
      return res.status(403).json({ message: 'Not authorized to update this board' });
    }

    const { title, visibility } = req.body;
    if (title !== undefined) board.title = title;
    if (visibility !== undefined) board.visibility = visibility;

    await board.save();

    res.json({ board });
  } catch (error) {
    console.error('Update board error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteBoard = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    // Only owner can delete
    if (board.ownerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Only the owner can delete this board' });
    }

    await Element.deleteMany({ boardId: board._id });
    await Board.findByIdAndDelete(board._id);

    res.json({ message: 'Board deleted successfully' });
  } catch (error) {
    console.error('Delete board error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.saveAsTemplate = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const collaborator = board.collaborators.find(
      (c) => c.userId.toString() === req.userId.toString()
    );
    if (!collaborator) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const template = await Board.create({
      title: `${board.title} (template)`,
      ownerId: req.userId,
      isTemplate: true,
      collaborators: [{ userId: req.userId, role: 'owner' }],
    });

    // Clone elements
    const elements = await Element.find({ boardId: board._id });
    const newElements = elements.map((el) => ({
      boardId: template._id,
      type: el.type,
      attrs: { ...el.attrs },
      zIndex: el.zIndex,
      createdBy: req.userId,
      updatedBy: req.userId,
    }));

    if (newElements.length > 0) {
      await Element.insertMany(newElements);
    }

    res.status(201).json({ template });
  } catch (error) {
    console.error('Save as template error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.regenerateInviteToken = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const collaborator = board.collaborators.find(
      (c) => c.userId.toString() === req.userId.toString()
    );
    if (!collaborator || collaborator.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can manage invites' });
    }

    board.inviteToken = uuidv4();
    await board.save();

    res.json({ inviteToken: board.inviteToken });
  } catch (error) {
    console.error('Regenerate invite token error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.addCollaborator = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const collaborator = board.collaborators.find(
      (c) => c.userId.toString() === req.userId.toString()
    );
    if (!collaborator || collaborator.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can add collaborators' });
    }

    const { userId, role } = req.body;
    if (!['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Role must be editor or viewer' });
    }

    const userIdStr = userId.toString();
    const alreadyExists = board.collaborators.some(
      (c) => c.userId.toString() === userIdStr
    );
    if (alreadyExists) {
      return res.status(400).json({ message: 'User is already a collaborator' });
    }

    board.collaborators.push({ userId, role });
    await board.save();

    const populated = await Board.findById(board._id)
      .populate('collaborators.userId', 'username email avatarColor');

    // Deduplicate collaborators by userId before sending response
    const seen = new Set();
    populated.collaborators = populated.collaborators.filter((c) => {
      const key = c.userId?._id?.toString() || c.userId?.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Ensure owner entry exists
    if (!seen.has(req.userId.toString())) {
      populated.collaborators.unshift({ userId: req.userId, role: 'owner' });
    }

    res.json({ board: populated });
  } catch (error) {
    console.error('Add collaborator error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.removeCollaborator = async (req, res) => {
  try {
    const board = await Board.findById(req.params.id);
    if (!board) {
      return res.status(404).json({ message: 'Board not found' });
    }

    const collaborator = board.collaborators.find(
      (c) => c.userId.toString() === req.userId.toString()
    );
    if (!collaborator || collaborator.role !== 'owner') {
      return res.status(403).json({ message: 'Only the owner can remove collaborators' });
    }

    board.collaborators = board.collaborators.filter(
      (c) => c.userId.toString() !== req.params.userId
    );
    await board.save();

    const populated = await Board.findById(board._id)
      .populate('collaborators.userId', 'username email avatarColor');

    // Deduplicate collaborators
    const seen = new Set();
    populated.collaborators = populated.collaborators.filter((c) => {
      const key = c.userId?._id?.toString() || c.userId?.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Ensure owner entry exists
    if (!seen.has(req.userId.toString())) {
      populated.collaborators.unshift({ userId: req.userId, role: 'owner' });
    }

    res.json({ board: populated });
  } catch (error) {
    console.error('Remove collaborator error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.joinByInvite = async (req, res) => {
  try {
    const board = await Board.findOne({ inviteToken: req.params.inviteToken });
    if (!board) {
      return res.status(404).json({ message: 'Invalid or expired invite link' });
    }

    const alreadyCollaborator = board.collaborators.some(
      (c) => c.userId.toString() === req.userId.toString()
    );

    if (!alreadyCollaborator) {
      board.collaborators.push({ userId: req.userId, role: 'editor' });
      await board.save();
    }

    res.json({ boardId: board._id });
  } catch (error) {
    console.error('Join by invite error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};