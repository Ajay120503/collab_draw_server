const User = require('../models/User');
const FriendRequest = require('../models/FriendRequest');

exports.sendRequest = async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId === req.userId.toString()) {
      return res.status(400).json({ message: 'Cannot send friend request to yourself' });
    }

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if already friends
    if (req.user.friends.includes(userId)) {
      return res.status(400).json({ message: 'Already friends with this user' });
    }

    // Check for existing pending request
    const existing = await FriendRequest.findOne({
      $or: [
        { from: req.userId, to: userId },
        { from: userId, to: req.userId },
      ],
      status: 'pending',
    });

    if (existing) {
      return res.status(400).json({ message: 'Friend request already exists' });
    }

    const friendRequest = await FriendRequest.create({
      from: req.userId,
      to: userId,
      status: 'pending',
    });

    res.status(201).json({ friendRequest });
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.respondRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'

    const friendRequest = await FriendRequest.findById(requestId);
    if (!friendRequest) {
      return res.status(404).json({ message: 'Friend request not found' });
    }

    if (friendRequest.to.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to respond to this request' });
    }

    if (friendRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Request already processed' });
    }

    if (action === 'accept') {
      friendRequest.status = 'accepted';
      await friendRequest.save();

      // Add each other as friends
      await User.findByIdAndUpdate(friendRequest.from, {
        $addToSet: { friends: friendRequest.to },
      });
      await User.findByIdAndUpdate(friendRequest.to, {
        $addToSet: { friends: friendRequest.from },
      });

      return res.json({ message: 'Friend request accepted', friendRequest });
    }

    if (action === 'reject') {
      friendRequest.status = 'rejected';
      await friendRequest.save();
      return res.json({ message: 'Friend request rejected', friendRequest });
    }

    res.status(400).json({ message: 'Invalid action, use "accept" or "reject"' });
  } catch (error) {
    console.error('Respond friend request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.listFriends = async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('friends', 'username email avatarColor');
    res.json({ friends: user.friends });
  } catch (error) {
    console.error('List friends error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.listRequests = async (req, res) => {
  try {
    const pendingRequests = await FriendRequest.find({
      to: req.userId,
      status: 'pending',
    }).populate('from', 'username email avatarColor');

    const sentRequests = await FriendRequest.find({
      from: req.userId,
      status: 'pending',
    }).populate('to', 'username email avatarColor');

    res.json({ pending: pendingRequests, sent: sentRequests });
  } catch (error) {
    console.error('List requests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};