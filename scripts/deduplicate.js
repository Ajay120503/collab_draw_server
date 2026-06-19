/**
 * One-time script to remove duplicate collaborators from existing boards.
 * Run: node scripts/deduplicate.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function deduplicate() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const boards = db.collection('boards');

  const cursor = boards.find({});
  let totalRemoved = 0;

  while (await cursor.hasNext()) {
    const board = await cursor.next();
    if (!board.collaborators || board.collaborators.length <= 1) continue;

    const seen = new Set();
    const originalCount = board.collaborators.length;
    const deduped = board.collaborators.filter((c) => {
      const key = c.userId ? c.userId.toString() : null;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (deduped.length < originalCount) {
      const removed = originalCount - deduped.length;
      totalRemoved += removed;
      console.log(`Board ${board._id} ("${board.title}"): removed ${removed} duplicate(s) (${originalCount} -> ${deduped.length})`);
      await boards.updateOne(
        { _id: board._id },
        { $set: { collaborators: deduped } }
      );
    }
  }

  console.log(`\nTotal duplicate entries removed: ${totalRemoved}`);
  await mongoose.disconnect();
}

deduplicate().catch(console.error);