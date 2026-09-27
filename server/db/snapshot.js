#!/usr/bin/env node
/**
 * Writes a consistent, self-contained copy of a tutoring.db to another path
 * -- safe even while the server is running and saving. Used by backup.sh
 * instead of copying the raw files: copying tutoring.db + tutoring.db-wal
 * by hand mid-save could capture the two out of step with each other.
 *
 * Usage: node server/db/snapshot.js <source tutoring.db> <destination .db>
 */

const { DatabaseSync, backup } = require('node:sqlite');

async function main() {
  const [source, dest] = process.argv.slice(2);
  if (!source || !dest) {
    console.error('Usage: node server/db/snapshot.js <source tutoring.db> <destination .db>');
    process.exit(1);
  }
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, dest);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`Snapshot failed: ${err.message}`);
  process.exit(1);
});
