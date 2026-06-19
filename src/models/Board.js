const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const collaboratorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['owner', 'editor', 'viewer'], required: true },
  },
  { _id: false }
);

const boardSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxlength: [100, 'Title must be at most 100 characters'],
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isTemplate: {
      type: Boolean,
      default: false,
    },
    visibility: {
      type: String,
      enum: ['private', 'link', 'public'],
      default: 'private',
    },
    inviteToken: {
      type: String,
      default: () => uuidv4(),
    },
    collaborators: [collaboratorSchema],
    thumbnail: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

boardSchema.index({ ownerId: 1 });
boardSchema.index({ 'collaborators.userId': 1 });
boardSchema.index({ inviteToken: 1 }, { unique: true });

// Auto-deduplicate collaborators before every save
boardSchema.pre('save', function (next) {
  const seen = new Set();
  this.collaborators = this.collaborators.filter((c) => {
    const key = c.userId?.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  next();
});

boardSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Board', boardSchema);
