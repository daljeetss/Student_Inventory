/**
 * The SQLite implementation of the data store contract described in
 * store.js. This is the only file in the whole app that knows the data
 * lives in a .db file, or what SQL it takes to read/write it.
 *
 * Uses Node's own built-in `node:sqlite` (no extra native dependency to
 * install/compile) -- one file, `tutoring.db`, inside the data folder
 * (production/ normally, or TUTORING_DATA_DIR for tests).
 *
 * Schema history (tracked with SQLite's own `PRAGMA user_version`):
 *   v0 -- one generic `records` table, every record stored as a JSON blob,
 *         and every save replaced a resource's whole array.
 *   v1 -- real tables (students, classes + class_students + class_slots,
 *         sessions + session_students, payments), foreign keys between
 *         them, and per-record saves with a `version` on every row so two
 *         devices can't silently overwrite each other (see putRecord).
 *   v2 -- session_students.extra_minutes: extra time a student stayed
 *         beyond a session's scheduled length (SessionRecord.extraMinutes),
 *         billed along with it.
 *
 * Moving v0 -> latest happens automatically the first time this opens an
 * old database (see migrateFromLegacy); a v1 database just gets the newer
 * additions (see upgradeSchema). It's built to never lose data: it snapshots
 * the whole database first (a never-pruned backups/pre-migration-v1-*.db),
 * copies everything into the new tables inside one transaction, then reads
 * every single record back and compares it to the original -- and if even
 * one record doesn't come back identical, it rolls the whole thing back
 * and refuses to start rather than run on half-migrated data. The old
 * `records` table is left in place, untouched.
 */

const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;
const MAX_BACKUPS = 200; // ~200 saves of headroom before the oldest per-save snapshots get pruned
const PRE_MIGRATION_PREFIX = 'pre-migration-'; // never pruned

const RESOURCES = ['students', 'classes', 'sessions', 'payments'];

// Every field each resource's client-side type (src/data/types.ts) has.
// Anything else a record happens to carry goes into that row's `extra`
// JSON column instead of being dropped -- so a field added to the app
// later can't be silently lost just because this file wasn't updated too.
const KNOWN_FIELDS = {
  students: ['id', 'name', 'grade', 'parentName', 'parentPhone', 'ratePerSession', 'notes', 'active', 'createdAt'],
  classes: ['id', 'name', 'type', 'studentIds', 'schedule', 'active', 'createdAt'],
  sessions: [
    'id', 'date', 'startTime', 'durationMinutes', 'groupId', 'isMakeup', 'makeupForRecordId',
    'studentIds', 'rosterCustomized', 'attendance', 'extraMinutes', 'notes', 'createdAt',
  ],
  payments: ['id', 'studentId', 'month', 'amountDue', 'amountPaid', 'status', 'datePaid', 'messageSentAt', 'createdAt'],
};

const SCHEMA_V1 = `
  CREATE TABLE students (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    grade            TEXT NOT NULL,
    parent_name      TEXT NOT NULL,
    parent_phone     TEXT NOT NULL,
    rate_per_session REAL NOT NULL,
    notes            TEXT,
    active           INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at       TEXT NOT NULL,
    extra            TEXT,
    version          INTEGER NOT NULL,
    seq              INTEGER NOT NULL
  );

  CREATE TABLE classes (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('one-on-one', 'group')),
    active     INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    extra      TEXT,
    version    INTEGER NOT NULL,
    seq        INTEGER NOT NULL
  );

  -- Who's in each class (ClassGroup.studentIds), in roster order.
  CREATE TABLE class_students (
    class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id),
    position   INTEGER NOT NULL,
    PRIMARY KEY (class_id, student_id)
  );

  -- Each class's weekly times (ClassGroup.schedule), in order.
  CREATE TABLE class_slots (
    class_id         TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    position         INTEGER NOT NULL,
    day_of_week      INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time       TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    PRIMARY KEY (class_id, position)
  );

  -- Attendance + makeup/rescheduled sessions (SessionRecord), distinguished
  -- by is_makeup. makeup_for_record_id is a plain link, deliberately not a
  -- foreign key: a makeup and the session it's for can be created in the
  -- same save, in either order.
  CREATE TABLE sessions (
    id                   TEXT PRIMARY KEY,
    date                 TEXT NOT NULL,
    start_time           TEXT NOT NULL,
    duration_minutes     INTEGER NOT NULL,
    group_id             TEXT REFERENCES classes(id),
    is_makeup            INTEGER NOT NULL CHECK (is_makeup IN (0, 1)),
    makeup_for_record_id TEXT,
    roster_customized    INTEGER CHECK (roster_customized IN (0, 1)),
    notes                TEXT,
    created_at           TEXT NOT NULL,
    extra                TEXT,
    version              INTEGER NOT NULL,
    seq                  INTEGER NOT NULL
  );
  CREATE INDEX sessions_by_date ON sessions(date);

  -- One row per student a session involves: roster_position is set if
  -- they're on the roster (SessionRecord.studentIds, in order), attendance
  -- is set if they've been marked (SessionRecord.attendance). Kept as one
  -- table rather than two so both come back exactly as they were saved,
  -- even when (rarely) someone is marked but no longer on the roster.
  CREATE TABLE session_students (
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id      TEXT NOT NULL REFERENCES students(id),
    roster_position INTEGER,
    attendance      TEXT CHECK (attendance IN ('present', 'absent')),
    PRIMARY KEY (session_id, student_id)
  );

  CREATE TABLE payments (
    id              TEXT PRIMARY KEY,
    student_id      TEXT NOT NULL REFERENCES students(id),
    month           TEXT NOT NULL,
    amount_due      REAL NOT NULL,
    amount_paid     REAL NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('unpaid', 'partially-paid', 'paid')),
    date_paid       TEXT,
    message_sent_at TEXT,
    created_at      TEXT NOT NULL,
    extra           TEXT,
    version         INTEGER NOT NULL,
    seq             INTEGER NOT NULL
  );
  CREATE INDEX payments_by_student_month ON payments(student_id, month);
`;

// Each later schema version's changes, applied in order on top of v1. Only
// ever additive (new columns/tables), so upgrading never rewrites data.
const SCHEMA_UPGRADES = {
  2: `ALTER TABLE session_students ADD COLUMN extra_minutes INTEGER
        CHECK (extra_minutes IS NULL OR extra_minutes > 0)`,
};

/** A problem with the data a client sent (bad shape, or a link to a
 * student/class that doesn't exist) -- the server answers 400, not 500. */
class ValidationError extends Error {}

// ---------- validation ----------

function check(record, field, type, { optional = false, nullable = false } = {}) {
  const value = record[field];
  if (value === undefined && optional) return;
  if (value === null && nullable) return;
  if (type === 'array' ? !Array.isArray(value) : typeof value !== type) {
    throw new ValidationError(`${field} must be ${type === 'array' ? 'an array' : `a ${type}`}`);
  }
}

function validate(resource, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new ValidationError('Expected a JSON object');
  check(record, 'id', 'string');
  check(record, 'createdAt', 'string');
  if (resource === 'students') {
    for (const f of ['name', 'grade', 'parentName', 'parentPhone']) check(record, f, 'string');
    check(record, 'ratePerSession', 'number');
    check(record, 'active', 'boolean');
    check(record, 'notes', 'string', { optional: true });
  } else if (resource === 'classes') {
    check(record, 'name', 'string');
    check(record, 'type', 'string');
    check(record, 'active', 'boolean');
    check(record, 'studentIds', 'array');
    check(record, 'schedule', 'array');
    for (const id of record.studentIds) if (typeof id !== 'string') throw new ValidationError('studentIds must be strings');
    for (const slot of record.schedule) {
      if (!slot || typeof slot !== 'object') throw new ValidationError('schedule entries must be objects');
      check(slot, 'dayOfWeek', 'number');
      check(slot, 'startTime', 'string');
      check(slot, 'durationMinutes', 'number');
      // Slots are stored as plain columns with no `extra`, so refuse
      // anything else rather than silently dropping it.
      const unknown = Object.keys(slot).filter((k) => !['dayOfWeek', 'startTime', 'durationMinutes'].includes(k));
      if (unknown.length > 0) throw new ValidationError(`Unknown schedule field(s): ${unknown.join(', ')}`);
    }
  } else if (resource === 'sessions') {
    check(record, 'date', 'string');
    check(record, 'startTime', 'string');
    check(record, 'durationMinutes', 'number');
    check(record, 'groupId', 'string', { nullable: true });
    check(record, 'isMakeup', 'boolean');
    check(record, 'makeupForRecordId', 'string', { optional: true });
    check(record, 'rosterCustomized', 'boolean', { optional: true });
    check(record, 'notes', 'string', { optional: true });
    check(record, 'studentIds', 'array');
    for (const id of record.studentIds) if (typeof id !== 'string') throw new ValidationError('studentIds must be strings');
    if (!record.attendance || typeof record.attendance !== 'object' || Array.isArray(record.attendance)) {
      throw new ValidationError('attendance must be an object');
    }
    if (record.extraMinutes !== undefined) {
      const extra = record.extraMinutes;
      if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new ValidationError('extraMinutes must be an object');
      for (const minutes of Object.values(extra)) {
        if (!Number.isInteger(minutes) || minutes <= 0) throw new ValidationError('extraMinutes values must be whole minutes above 0');
      }
    }
  } else if (resource === 'payments') {
    check(record, 'studentId', 'string');
    check(record, 'month', 'string');
    check(record, 'amountDue', 'number');
    check(record, 'amountPaid', 'number');
    check(record, 'status', 'string');
    check(record, 'datePaid', 'string', { optional: true });
    check(record, 'messageSentAt', 'string', { optional: true });
  }
}

function extraOf(resource, record) {
  const extra = {};
  for (const key of Object.keys(record)) {
    if (key !== '_version' && !KNOWN_FIELDS[resource].includes(key)) extra[key] = record[key];
  }
  return Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
}

const bool = (v) => (v ? 1 : 0);
const optionalBool = (v) => (v === undefined ? null : bool(v));
const orNull = (v) => (v === undefined ? null : v);

/** Canonical JSON (object keys sorted, at every depth) -- used to check
 * that a record read back from the new tables is *exactly* the record
 * that went in, regardless of key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---------- the store ----------

function createSqliteStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'tutoring.db');
  const backupsDir = path.join(dataDir, 'backups');
  const isNewDatabase = !fs.existsSync(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL'); // readers/writers don't block each other on the same file
  db.exec('PRAGMA foreign_keys = ON');

  // ---------- writing one record into the typed tables ----------

  const nextSeq = (table) => db.prepare(`SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM ${table}`).get().n;

  const writers = {
    students(s, version, seq) {
      db.prepare(
        `INSERT INTO students (id, name, grade, parent_name, parent_phone, rate_per_session, notes, active, created_at, extra, version, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, grade = excluded.grade, parent_name = excluded.parent_name,
           parent_phone = excluded.parent_phone, rate_per_session = excluded.rate_per_session, notes = excluded.notes,
           active = excluded.active, created_at = excluded.created_at, extra = excluded.extra, version = excluded.version`,
      ).run(s.id, s.name, s.grade, s.parentName, s.parentPhone, s.ratePerSession, orNull(s.notes), bool(s.active),
        s.createdAt, extraOf('students', s), version, seq);
    },

    classes(c, version, seq) {
      db.prepare(
        `INSERT INTO classes (id, name, type, active, created_at, extra, version, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, active = excluded.active,
           created_at = excluded.created_at, extra = excluded.extra, version = excluded.version`,
      ).run(c.id, c.name, c.type, bool(c.active), c.createdAt, extraOf('classes', c), version, seq);
      db.prepare('DELETE FROM class_students WHERE class_id = ?').run(c.id);
      db.prepare('DELETE FROM class_slots WHERE class_id = ?').run(c.id);
      const addStudent = db.prepare('INSERT INTO class_students (class_id, student_id, position) VALUES (?, ?, ?)');
      c.studentIds.forEach((sid, i) => addStudent.run(c.id, sid, i));
      const addSlot = db.prepare(
        'INSERT INTO class_slots (class_id, position, day_of_week, start_time, duration_minutes) VALUES (?, ?, ?, ?, ?)',
      );
      c.schedule.forEach((slot, i) => addSlot.run(c.id, i, slot.dayOfWeek, slot.startTime, slot.durationMinutes));
    },

    sessions(s, version, seq) {
      db.prepare(
        `INSERT INTO sessions (id, date, start_time, duration_minutes, group_id, is_makeup, makeup_for_record_id,
           roster_customized, notes, created_at, extra, version, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET date = excluded.date, start_time = excluded.start_time,
           duration_minutes = excluded.duration_minutes, group_id = excluded.group_id, is_makeup = excluded.is_makeup,
           makeup_for_record_id = excluded.makeup_for_record_id, roster_customized = excluded.roster_customized,
           notes = excluded.notes, created_at = excluded.created_at, extra = excluded.extra, version = excluded.version`,
      ).run(s.id, s.date, s.startTime, s.durationMinutes, s.groupId, bool(s.isMakeup), orNull(s.makeupForRecordId),
        optionalBool(s.rosterCustomized), orNull(s.notes), s.createdAt, extraOf('sessions', s), version, seq);
      db.prepare('DELETE FROM session_students WHERE session_id = ?').run(s.id);
      const add = db.prepare(
        'INSERT INTO session_students (session_id, student_id, roster_position, attendance, extra_minutes) VALUES (?, ?, ?, ?, ?)',
      );
      const extra = s.extraMinutes ?? {};
      const involved = new Set([...s.studentIds, ...Object.keys(s.attendance), ...Object.keys(extra)]);
      for (const sid of involved) {
        const pos = s.studentIds.indexOf(sid);
        add.run(s.id, sid, pos >= 0 ? pos : null, orNull(s.attendance[sid]), orNull(extra[sid]));
      }
    },

    payments(p, version, seq) {
      db.prepare(
        `INSERT INTO payments (id, student_id, month, amount_due, amount_paid, status, date_paid, message_sent_at,
           created_at, extra, version, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET student_id = excluded.student_id, month = excluded.month,
           amount_due = excluded.amount_due, amount_paid = excluded.amount_paid, status = excluded.status,
           date_paid = excluded.date_paid, message_sent_at = excluded.message_sent_at, created_at = excluded.created_at,
           extra = excluded.extra, version = excluded.version`,
      ).run(p.id, p.studentId, p.month, p.amountDue, p.amountPaid, p.status, orNull(p.datePaid), orNull(p.messageSentAt),
        p.createdAt, extraOf('payments', p), version, seq);
    },
  };

  // ---------- reading records back out of the typed tables ----------

  const withExtra = (obj, extra) => (extra ? { ...obj, ...JSON.parse(extra) } : obj);

  const readers = {
    students(where = '', args = []) {
      return db.prepare(`SELECT * FROM students ${where} ORDER BY seq`).all(...args).map((r) => ({
        record: withExtra(
          {
            id: r.id,
            name: r.name,
            grade: r.grade,
            parentName: r.parent_name,
            parentPhone: r.parent_phone,
            ratePerSession: r.rate_per_session,
            ...(r.notes !== null ? { notes: r.notes } : {}),
            active: r.active === 1,
            createdAt: r.created_at,
          },
          r.extra,
        ),
        version: r.version,
      }));
    },

    classes(where = '', args = []) {
      const rows = db.prepare(`SELECT * FROM classes ${where} ORDER BY seq`).all(...args);
      const students = db.prepare('SELECT student_id FROM class_students WHERE class_id = ? ORDER BY position');
      const slots = db.prepare('SELECT * FROM class_slots WHERE class_id = ? ORDER BY position');
      return rows.map((r) => ({
        record: withExtra(
          {
            id: r.id,
            name: r.name,
            type: r.type,
            studentIds: students.all(r.id).map((s) => s.student_id),
            schedule: slots.all(r.id).map((s) => ({
              dayOfWeek: s.day_of_week,
              startTime: s.start_time,
              durationMinutes: s.duration_minutes,
            })),
            active: r.active === 1,
            createdAt: r.created_at,
          },
          r.extra,
        ),
        version: r.version,
      }));
    },

    sessions(where = '', args = []) {
      const rows = db.prepare(`SELECT * FROM sessions ${where} ORDER BY seq`).all(...args);
      const involved = db.prepare('SELECT * FROM session_students WHERE session_id = ?');
      return rows.map((r) => {
        const people = involved.all(r.id);
        const studentIds = people
          .filter((p) => p.roster_position !== null)
          .sort((a, b) => a.roster_position - b.roster_position)
          .map((p) => p.student_id);
        const attendance = {};
        for (const p of people) if (p.attendance !== null) attendance[p.student_id] = p.attendance;
        const extraMinutes = {};
        for (const p of people) if (p.extra_minutes != null) extraMinutes[p.student_id] = p.extra_minutes;
        return {
          record: withExtra(
            {
              id: r.id,
              date: r.date,
              startTime: r.start_time,
              durationMinutes: r.duration_minutes,
              groupId: r.group_id,
              isMakeup: r.is_makeup === 1,
              ...(r.makeup_for_record_id !== null ? { makeupForRecordId: r.makeup_for_record_id } : {}),
              studentIds,
              ...(r.roster_customized !== null ? { rosterCustomized: r.roster_customized === 1 } : {}),
              attendance,
              ...(Object.keys(extraMinutes).length > 0 ? { extraMinutes } : {}),
              ...(r.notes !== null ? { notes: r.notes } : {}),
              createdAt: r.created_at,
            },
            r.extra,
          ),
          version: r.version,
        };
      });
    },

    payments(where = '', args = []) {
      return db.prepare(`SELECT * FROM payments ${where} ORDER BY seq`).all(...args).map((r) => ({
        record: withExtra(
          {
            id: r.id,
            studentId: r.student_id,
            month: r.month,
            amountDue: r.amount_due,
            amountPaid: r.amount_paid,
            status: r.status,
            ...(r.date_paid !== null ? { datePaid: r.date_paid } : {}),
            ...(r.message_sent_at !== null ? { messageSentAt: r.message_sent_at } : {}),
            createdAt: r.created_at,
          },
          r.extra,
        ),
        version: r.version,
      }));
    },
  };

  const readOne = (resource, id) => readers[resource]('WHERE id = ?', [id])[0] ?? null;

  // ---------- snapshots ----------

  /** A consistent, synchronous whole-database copy (VACUUM INTO writes a
   * fresh, self-contained .db -- no -wal file needed alongside it). */
  function snapshotSync(fileName) {
    fs.mkdirSync(backupsDir, { recursive: true });
    const dest = path.join(backupsDir, fileName);
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    return dest;
  }

  const hasAnyData = () =>
    RESOURCES.some((t) => tableExists(t) && db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());

  // Snapshot the whole database before every write -- the same safety net
  // as ever (real user data was lost once, from testing directly against
  // live files; see DESIGN.md). Skipped while there's nothing yet to
  // snapshot. Pruned to the most recent ~200, except pre-migration
  // snapshots, which are kept forever.
  async function backupSnapshot() {
    try {
      if (!hasAnyData()) return;
      fs.mkdirSync(backupsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await backup(db, path.join(backupsDir, `${stamp}.db`)); // safe hot-copy, even mid-WAL

      const snapshots = fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.db') && !f.startsWith(PRE_MIGRATION_PREFIX))
        .sort();
      for (const old of snapshots.slice(0, Math.max(0, snapshots.length - MAX_BACKUPS))) {
        fs.rmSync(path.join(backupsDir, old), { force: true });
      }
    } catch {
      // best-effort -- never let a backup failure block the actual save
    }
  }

  // ---------- migration ----------

  function tableExists(name) {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  /** Where the pre-v1 data comes from: the v0 `records` table if there is
   * one, else (a brand-new database sitting next to the even older
   * one-JSON-file-per-resource layout) those JSON files. Either way, old
   * "attendance"/"makeup" become the one "sessions" resource. */
  function readLegacySource() {
    const source = { students: [], classes: [], sessions: [], payments: [] };
    const legacyToResource = { students: 'students', classes: 'classes', attendance: 'sessions', makeup: 'sessions', payments: 'payments' };

    if (tableExists('records')) {
      for (const row of db.prepare('SELECT resource, data FROM records ORDER BY resource, seq').all()) {
        const resource = legacyToResource[row.resource];
        if (!resource) throw new Error(`Unknown resource "${row.resource}" in the old records table`);
        source[resource].push(JSON.parse(row.data));
      }
      return source;
    }

    if (isNewDatabase) {
      for (const legacy of Object.keys(legacyToResource)) {
        const file = path.join(dataDir, `${legacy}.json`);
        if (!fs.existsSync(file)) continue;
        let records;
        try {
          records = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
          continue; // corrupt/unreadable legacy file -- nothing safe to migrate from it
        }
        if (Array.isArray(records)) source[legacyToResource[legacy]].push(...records);
      }
    }
    return source;
  }

  /** Snapshot before an upgrade changes anything -- kept forever. */
  function preUpgradeSnapshot() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = snapshotSync(`${PRE_MIGRATION_PREFIX}v${SCHEMA_VERSION}-${stamp}.db`);
    console.log(`[tutoring-tracker] Saved a pre-upgrade copy of your data: ${dest}`);
  }

  const applySchemaUpgrades = (fromVersion) => {
    for (let v = fromVersion + 1; v <= SCHEMA_VERSION; v++) db.exec(SCHEMA_UPGRADES[v]);
  };

  /** v0 (or older JSON files) -> latest: copy everything into the real
   * tables, then verify every record before committing. */
  function migrateFromLegacy() {
    const source = readLegacySource();
    const total = RESOURCES.reduce((n, r) => n + source[r].length, 0);

    if (!isNewDatabase) preUpgradeSnapshot();

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('PRAGMA defer_foreign_keys = ON'); // insert order doesn't matter; links are checked at COMMIT
      db.exec(SCHEMA_V1);
      applySchemaUpgrades(1);
      for (const resource of RESOURCES) {
        source[resource].forEach((record, i) => {
          validate(resource, record);
          writers[resource](record, 1, i);
        });
      }

      // Read every record back and compare it to the original. Anything
      // other than a perfect match means something would be lost -- so
      // stop and leave the database exactly as it was.
      for (const resource of RESOURCES) {
        const migrated = new Map(readers[resource]().map(({ record }) => [record.id, canonical(record)]));
        if (migrated.size !== source[resource].length) {
          throw new Error(`${resource}: expected ${source[resource].length} records after upgrade, found ${migrated.size}`);
        }
        for (const original of source[resource]) {
          if (migrated.get(original.id) !== canonical(original)) {
            throw new Error(`${resource} record ${original.id} did not come back identical after upgrade`);
          }
        }
      }

      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT'); // foreign keys are verified here; a broken link fails the commit
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // COMMIT itself may have failed and already rolled back
      }
      db.close();
      throw new Error(
        `Database upgrade stopped, nothing was changed: ${err.message}. Your data is untouched in ${dbPath}.`,
      );
    }

    // Fold the write-ahead log into the main .db file, so the .db file on
    // its own is complete from here on.
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if (total > 0) {
      console.log(`[tutoring-tracker] Upgraded the database to real tables: ${total} records moved, every one verified identical.`);
    }
  }

  /** v1+ -> latest: the later upgrades are only additive (new columns), so
   * there's nothing to copy or re-verify -- just snapshot, then apply them
   * in one transaction (all or nothing). */
  function upgradeSchema(fromVersion) {
    preUpgradeSnapshot();
    db.exec('BEGIN IMMEDIATE');
    try {
      applySchemaUpgrades(fromVersion);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      db.close();
      throw new Error(`Database upgrade stopped, nothing was changed: ${err.message}. Your data is untouched in ${dbPath}.`);
    }
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    console.log(`[tutoring-tracker] Upgraded the database from schema v${fromVersion} to v${SCHEMA_VERSION}.`);
  }

  const currentVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (currentVersion === 0) migrateFromLegacy();
  else if (currentVersion < SCHEMA_VERSION) upgradeSchema(currentVersion);
  else if (currentVersion > SCHEMA_VERSION) {
    db.close();
    throw new Error(`This database (schema v${currentVersion}) is newer than this version of the app (v${SCHEMA_VERSION}). Update the app.`);
  }

  // ---------- the public contract (see store.js) ----------

  function assertResource(resource) {
    if (!RESOURCES.includes(resource)) throw new ValidationError(`Unknown resource "${resource}"`);
  }

  function getResource(resource) {
    assertResource(resource);
    return readers[resource]().map(({ record, version }) => ({ ...record, _version: version }));
  }

  // Wraps a synchronous read-check-write in one IMMEDIATE transaction, so
  // the version check and the write can't be split by another request.
  // A constraint failure (e.g. a class naming a student that doesn't
  // exist) is the client's problem, so it surfaces as a ValidationError.
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      if (err instanceof ValidationError) throw err;
      if (/constraint/i.test(String(err.message))) throw new ValidationError(err.message);
      throw err;
    }
  }

  const currentRow = (resource, id) => db.prepare(`SELECT version, seq FROM ${resource} WHERE id = ?`).get(id);

  /**
   * Saves one record, but only if the caller is working from the latest
   * version of it. `baseVersion` is the version the caller last saw (from
   * getResource or a previous putRecord), or null if it believes the
   * record doesn't exist yet. If someone else saved it in the meantime
   * (or created/deleted it), nothing is written and the latest copy comes
   * back as `current`, so two devices can never silently overwrite each
   * other's changes.
   */
  async function putRecord(resource, id, record, baseVersion) {
    assertResource(resource);
    validate(resource, record);
    if (record.id !== id) throw new ValidationError('Record id does not match the URL');
    const clean = { ...record };
    delete clean._version;

    await backupSnapshot();
    return transaction(() => {
      const row = currentRow(resource, id);
      const expected = row ? row.version : null;
      if (baseVersion !== expected) {
        return { ok: false, conflict: true, version: expected, current: row ? readOne(resource, id).record : null };
      }
      const version = row ? row.version + 1 : 1;
      writers[resource](clean, version, row ? row.seq : nextSeq(resource));
      return { ok: true, version };
    });
  }

  /** Deletes one record, with the same version check as putRecord.
   * Deleting something that's already gone is treated as success. */
  async function deleteRecord(resource, id, baseVersion) {
    assertResource(resource);
    await backupSnapshot();
    return transaction(() => {
      const row = currentRow(resource, id);
      if (!row) return { ok: true, version: null };
      if (baseVersion !== row.version) {
        return { ok: false, conflict: true, version: row.version, current: readOne(resource, id).record };
      }
      db.prepare(`DELETE FROM ${resource} WHERE id = ?`).run(id);
      return { ok: true, version: null };
    });
  }

  function close() {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // closing anyway
    }
    db.close();
  }

  return { getResource, putRecord, deleteRecord, close };
}

module.exports = { createSqliteStore, ValidationError, RESOURCES, canonical, SCHEMA_V1 };
