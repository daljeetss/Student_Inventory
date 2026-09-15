/**
 * The SQLite implementation of the data store contract described in
 * store.js. This is the only file in the whole app that knows the data
 * lives in a .db file, or what SQL it takes to read/write it.
 *
 * Uses Node's own built-in `node:sqlite` (stable enough here, and means
 * zero extra native dependencies to install/compile) -- one file,
 * `tutoring.db`, inside the data folder (production/ normally, or
 * TUTORING_DATA_DIR for tests). Every record from every resource lives in
 * one `records` table (resource, id, seq, data-as-JSON) rather than one
 * table-per-resource with fixed columns: the API's contract has always
 * been "the client owns the shape, the server just persists whatever JSON
 * array it's given," and this keeps that true instead of silently
 * constraining it. `seq` preserves save order (array order matters -- it's
 * what the UI renders in) since a table has no inherent row order of its
 * own.
 */

const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const RESOURCES = ['students', 'classes', 'attendance', 'makeup', 'payments'];
const MAX_BACKUPS = 200; // ~200 saves of headroom before the oldest snapshots get pruned

function idFor(record, fallbackIndex) {
  return record && typeof record === 'object' && record.id != null ? String(record.id) : String(fallbackIndex);
}

// One-time, automatic: if this is a brand new database and the old
// one-JSON-file-per-resource layout (from before this SQLite migration) is
// still sitting in this folder, import it so nothing has to be done by
// hand -- "npm run serve" just picks up right where it left off. Never
// deletes or modifies the original .json files; they're left in place,
// untouched, as an extra safety copy of their own.
function migrateLegacyJsonFiles(dataDir, db, insert) {
  let migratedAny = false;
  for (const resource of RESOURCES) {
    const file = path.join(dataDir, `${resource}.json`);
    if (!fs.existsSync(file)) continue;

    let records;
    try {
      records = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // corrupt/unreadable legacy file -- nothing safe to migrate from it
    }
    if (!Array.isArray(records) || records.length === 0) continue;

    db.exec('BEGIN');
    records.forEach((record, i) => insert.run(resource, idFor(record, i), i, JSON.stringify(record)));
    db.exec('COMMIT');
    migratedAny = true;
  }
  if (migratedAny) {
    console.log('[tutoring-tracker] Migrated existing production/*.json data into tutoring.db (original files left untouched).');
  }
}

function createSqliteStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'tutoring.db');
  const backupsDir = path.join(dataDir, 'backups');
  const isNewDatabase = !fs.existsSync(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL'); // readers/writers don't block each other on the same file
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      resource TEXT NOT NULL,
      id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (resource, id)
    )
  `);

  const insertStmt = db.prepare('INSERT INTO records (resource, id, seq, data) VALUES (?, ?, ?, ?)');
  const deleteResourceStmt = db.prepare('DELETE FROM records WHERE resource = ?');
  const selectResourceStmt = db.prepare('SELECT data FROM records WHERE resource = ? ORDER BY seq ASC');
  const hasAnyDataStmt = db.prepare('SELECT 1 FROM records LIMIT 1');

  if (isNewDatabase) migrateLegacyJsonFiles(dataDir, db, insertStmt);

  function getResource(resource) {
    return selectResourceStmt.all(resource).map((row) => JSON.parse(row.data));
  }

  // Snapshot the whole database file before any write -- same rationale as
  // the old per-write folder snapshot (real user data was lost once, from
  // testing directly against live files; see DESIGN.md). Skipped on the
  // very first write ever, since there's nothing yet to snapshot.
  async function backupSnapshot() {
    try {
      if (!hasAnyDataStmt.get()) return;

      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backup(db, path.join(backupsDir, `${stamp}.db`)); // safe hot-copy, even mid-WAL

      const snapshots = fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db')).sort();
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_BACKUPS))) {
        fs.rmSync(path.join(backupsDir, old), { force: true });
      }
    } catch {
      // best-effort -- never let a backup failure block the actual save
    }
  }

  // Whole-resource replace, matching the API's existing "POST the full,
  // current array" contract -- same semantics as the old one-JSON-file-per-
  // resource approach, just backed by a real transaction now (a write
  // either fully lands or fully doesn't, never half of one).
  async function setResource(resource, records) {
    await backupSnapshot();
    db.exec('BEGIN');
    try {
      deleteResourceStmt.run(resource);
      records.forEach((record, i) => insertStmt.run(resource, idFor(record, i), i, JSON.stringify(record)));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  function close() {
    db.close();
  }

  return { getResource, setResource, close };
}

module.exports = { createSqliteStore };
