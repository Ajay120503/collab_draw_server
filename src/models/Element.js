const mongoose = require('mongoose');

const elementSchema = new mongoose.Schema(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['freehand', 'pen', 'rect', 'ellipse', 'line', 'arrow', 'text', 'image', 'sticky'],
    },
    attrs: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    zIndex: {
      type: Number,
      default: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

elementSchema.index({ boardId: 1, zIndex: 1 });

elementSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('Element', elementSchema);