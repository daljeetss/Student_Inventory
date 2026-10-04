// Unit tests for the SQLite data store (server/db/) in isolation -- no HTTP
// involved (that's serve.test.js). Every test opens its own throwaway tmp
// directory; never touches app/production/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { openStore, ValidationError } = require('../store');

let dataDir;
let log;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutoring-store-test-'));
  log = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------- realistic records, shaped like src/data/types.ts ----------

const student = (id, extra = {}) => ({
  id,
  name: `Student ${id}`,
  grade: '3',
  parentName: 'Priya',
  parentPhone: '15551234567',
  ratePerSession: 30,
  active: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

const klass = (id, studentIds, extra = {}) => ({
  id,
  name: `Class ${id}`,
  type: studentIds.length > 1 ? 'group' : 'one-on-one',
  studentIds,
  schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 }],
  active: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

const session = (id, groupId, studentIds, attendance, extra = {}) => ({
  id,
  date: '2026-09-08',
  startTime: '16:00',
  durationMinutes: 60,
  groupId,
  isMakeup: false,
  studentIds,
  attendance,
  createdAt: '2026-09-08T00:00:00.000Z',
  ...extra,
});

const payment = (id, studentId, extra = {}) => ({
  id,
  studentId,
  month: '2026-09',
  amountDue: 60,
  amountPaid: 0,
  status: 'unpaid',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

const withoutVersion = (records) => records.map(({ _version, ...r }) => r);

/** Builds a v0-format database (one generic `records` table), the way the
 * store looked before real tables -- i.e. what's in production/ today. */
function makeV0Database(dir, byResource) {
  const db = new DatabaseSync(path.join(dir, 'tutoring.db'));
  db.exec('CREATE TABLE records (resource TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (resource, id))');
  const insert = db.prepare('INSERT INTO records (resource, id, seq, data) VALUES (?, ?, ?, ?)');
  for (const [resource, records] of Object.entries(byResource)) {
    records.forEach((r, i) => insert.run(resource, r.id, i, JSON.stringify(r)));
  }
  db.close();
}

const inspect = (dir, sql) => {
  const db = new DatabaseSync(path.join(dir, 'tutoring.db'), { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};

// ---------- basics ----------

describe('a new, empty store', () => {
  it('starts empty for every resource', () => {
    const store = openStore(dataDir);
    for (const r of ['students', 'classes', 'sessions', 'payments']) expect(store.getResource(r)).toEqual([]);
    store.close();
  });

  it('uses real tables with foreign keys', () => {
    openStore(dataDir).close();
    const tables = inspect(dataDir, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining(['students', 'classes', 'class_students', 'class_slots', 'sessions', 'session_students', 'payments']),
    );
    expect(inspect(dataDir, 'PRAGMA user_version')[0].user_version).toBe(3);
  });
});

describe('round-tripping every kind of record exactly', () => {
  it('students, including optional notes', async () => {
    const store = openStore(dataDir);
    const a = student('a', { notes: 'Needs fractions practice' });
    const b = student('b', { active: false, ratePerSession: 42.5 });
    await store.putRecord('students', 'a', a, null);
    await store.putRecord('students', 'b', b, null);
    expect(withoutVersion(store.getResource('students'))).toEqual([a, b]);
    store.close();
  });

  it('classes, with roster order and weekly slots', async () => {
    const store = openStore(dataDir);
    for (const id of ['s1', 's2', 's3']) await store.putRecord('students', id, student(id), null);
    const c = klass('c', ['s3', 's1', 's2'], {
      schedule: [
        { dayOfWeek: 4, startTime: '17:00', durationMinutes: 45 },
        { dayOfWeek: 2, startTime: '16:00', durationMinutes: 60 },
      ],
    });
    await store.putRecord('classes', 'c', c, null);
    expect(withoutVersion(store.getResource('classes'))).toEqual([c]);
    store.close();
  });

  it('sessions: regular, customized roster, makeup, and someone marked but no longer on the roster', async () => {
    const store = openStore(dataDir);
    for (const id of ['s1', 's2']) await store.putRecord('students', id, student(id), null);
    await store.putRecord('classes', 'c', klass('c', ['s1', 's2']), null);

    const regular = session('c_2026-09-08_16:00', 'c', ['s1', 's2'], { s1: 'present', s2: 'absent' }, { rosterCustomized: false });
    const shrunk = session('c_2026-09-15_16:00', 'c', ['s2'], { s1: 'present' }, { rosterCustomized: true });
    const makeup = session('sess_mk', null, ['s1'], {}, { isMakeup: true, makeupForRecordId: regular.id, notes: 'moved' });
    for (const s of [regular, shrunk, makeup]) await store.putRecord('sessions', s.id, s, null);

    expect(withoutVersion(store.getResource('sessions'))).toEqual([regular, shrunk, makeup]);
    store.close();
  });

  it('sessions with extra time for some students', async () => {
    const store = openStore(dataDir);
    for (const id of ['s1', 's2']) await store.putRecord('students', id, student(id), null);
    await store.putRecord('classes', 'c', klass('c', ['s1', 's2']), null);
    const s = session('c_2026-10-05_16:00', 'c', ['s1', 's2'], { s1: 'present', s2: 'present' }, { extraMinutes: { s1: 30 } });
    await store.putRecord('sessions', s.id, s, null);
    expect(withoutVersion(store.getResource('sessions'))).toEqual([s]);

    // Removing the extra time removes it, rather than leaving a stale value.
    const { extraMinutes, ...without } = s;
    await store.putRecord('sessions', s.id, without, 1);
    expect(withoutVersion(store.getResource('sessions'))).toEqual([without]);
    store.close();
  });

  it('rejects extra time that is not whole minutes above zero', async () => {
    const store = openStore(dataDir);
    await store.putRecord('students', 's1', student('s1'), null);
    for (const bad of [{ s1: 0 }, { s1: -30 }, { s1: 12.5 }, { s1: '30' }, [30]]) {
      await expect(
        store.putRecord('sessions', 'x', session('x', null, ['s1'], { s1: 'present' }, { extraMinutes: bad }), null),
      ).rejects.toThrow(ValidationError);
    }
    store.close();
  });

  it('payments, including optional dates', async () => {
    const store = openStore(dataDir);
    await store.putRecord('students', 's1', student('s1'), null);
    const p = payment('pay_s1_2026-09', 's1', { amountPaid: 60, status: 'paid', datePaid: '2026-09-20', messageSentAt: '2026-09-19' });
    await store.putRecord('payments', p.id, p, null);
    expect(withoutVersion(store.getResource('payments'))).toEqual([p]);
    store.close();
  });

  it('keeps fields it does not know about, rather than dropping them', async () => {
    const store = openStore(dataDir);
    const a = student('a', { nickname: 'Ace', tags: ['new'] });
    await store.putRecord('students', 'a', a, null);
    expect(withoutVersion(store.getResource('students'))).toEqual([a]);
    store.close();
  });

  it('persists to disk -- a new store on the same folder sees earlier saves', async () => {
    const store1 = openStore(dataDir);
    await store1.putRecord('students', 'a', student('a'), null);
    store1.close();
    const store2 = openStore(dataDir);
    expect(withoutVersion(store2.getResource('students'))).toEqual([student('a')]);
    store2.close();
  });
});

// ---------- versions: two devices can't overwrite each other ----------

describe('putRecord / deleteRecord version checks', () => {
  it('creates at version 1 and bumps the version on every update', async () => {
    const store = openStore(dataDir);
    expect(await store.putRecord('students', 'a', student('a'), null)).toEqual({ ok: true, version: 1 });
    expect(await store.putRecord('students', 'a', student('a', { name: 'Ava' }), 1)).toEqual({ ok: true, version: 2 });
    expect(store.getResource('students')[0]).toMatchObject({ name: 'Ava', _version: 2 });
    store.close();
  });

  it('refuses a save based on an out-of-date version, and returns the newer copy', async () => {
    const store = openStore(dataDir);
    await store.putRecord('students', 'a', student('a'), null);
    await store.putRecord('students', 'a', student('a', { name: 'From phone' }), 1); // now v2

    const result = await store.putRecord('students', 'a', student('a', { name: 'From laptop' }), 1);
    expect(result).toMatchObject({ ok: false, conflict: true, version: 2, current: { name: 'From phone' } });
    expect(store.getResource('students')[0].name).toBe('From phone'); // untouched
    store.close();
  });

  it('refuses to "create" something that already exists, or update something deleted', async () => {
    const store = openStore(dataDir);
    await store.putRecord('students', 'a', student('a'), null);
    expect(await store.putRecord('students', 'a', student('a', { name: 'dup' }), null)).toMatchObject({ conflict: true, version: 1 });

    await store.putRecord('students', 'gone', student('gone'), null);
    await store.deleteRecord('students', 'gone', 1);
    expect(await store.putRecord('students', 'gone', student('gone'), 1)).toMatchObject({ conflict: true, current: null });
    store.close();
  });

  it('deletes with the same check, and treats already-deleted as done', async () => {
    const store = openStore(dataDir);
    await store.putRecord('students', 'a', student('a'), null);
    await store.putRecord('students', 'a', student('a', { name: 'v2' }), 1);
    expect(await store.deleteRecord('students', 'a', 1)).toMatchObject({ ok: false, conflict: true });
    expect(await store.deleteRecord('students', 'a', 2)).toEqual({ ok: true, version: null });
    expect(await store.deleteRecord('students', 'a', 2)).toEqual({ ok: true, version: null });
    expect(store.getResource('students')).toEqual([]);
    store.close();
  });

  it('keeps list order: new records go at the end, updates stay in place', async () => {
    const store = openStore(dataDir);
    for (const id of ['a', 'b', 'c']) await store.putRecord('students', id, student(id), null);
    await store.putRecord('students', 'a', student('a', { name: 'A2' }), 1);
    expect(store.getResource('students').map((s) => s.id)).toEqual(['a', 'b', 'c']);
    store.close();
  });
});

// ---------- the database protects the links between records ----------

describe('validation and links', () => {
  it('rejects a class listing a student that does not exist, writing nothing', async () => {
    const store = openStore(dataDir);
    await expect(store.putRecord('classes', 'c', klass('c', ['ghost']), null)).rejects.toThrow(ValidationError);
    expect(store.getResource('classes')).toEqual([]);
    store.close();
  });

  it('rejects a payment for a student that does not exist', async () => {
    const store = openStore(dataDir);
    await expect(store.putRecord('payments', 'p', payment('p', 'ghost'), null)).rejects.toThrow(ValidationError);
    store.close();
  });

  it('rejects malformed records and a mismatched id', async () => {
    const store = openStore(dataDir);
    const { name, ...noName } = student('a');
    await expect(store.putRecord('students', 'a', noName, null)).rejects.toThrow(/name/);
    await expect(store.putRecord('students', 'a', student('a', { ratePerSession: 'thirty' }), null)).rejects.toThrow(ValidationError);
    await expect(store.putRecord('students', 'b', student('a'), null)).rejects.toThrow(/does not match/);
    await expect(store.putRecord('payments', 'p', { id: 'p' }, null)).rejects.toThrow(ValidationError);
    store.close();
  });

  it('rejects an unknown resource', async () => {
    const store = openStore(dataDir);
    expect(() => store.getResource('attendance')).toThrow(ValidationError);
    store.close();
  });
});

// ---------- per-save backups ----------

describe('automatic backups', () => {
  const backupFiles = () => {
    const dir = path.join(dataDir, 'backups');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.db')) : [];
  };

  it('skips the very first save ever (nothing to snapshot yet), then snapshots before each save', async () => {
    const store = openStore(dataDir);
    await store.putRecord('students', 'a', student('a', { name: 'v1' }), null);
    expect(backupFiles()).toHaveLength(0);

    await store.putRecord('students', 'a', student('a', { name: 'v2' }), 1);
    const files = backupFiles();
    expect(files).toHaveLength(1);

    const snap = new DatabaseSync(path.join(dataDir, 'backups', files[0]), { readOnly: true });
    expect(snap.prepare('SELECT name FROM students').get().name).toBe('v1');
    snap.close();
    store.close();
  });
});

// ---------- upgrading today's production/ format (v0) ----------

describe('upgrading an old (v0) database', () => {
  const s1 = student('s1');
  const s2 = student('s2', { notes: 'Parent prefers Tuesdays' });
  const c1 = klass('c1', ['s1', 's2']);
  const att = session('c1_2026-09-08_16:00', 'c1', ['s1', 's2'], { s1: 'present', s2: 'absent' }, { rosterCustomized: false });
  const mk = session('sess_mk', null, ['s2'], {}, { isMakeup: true, makeupForRecordId: att.id });
  const pay = payment('pay_s1_2026-09', 's1', { messageSentAt: '2026-09-19T00:00:00.000Z' });
  const v0 = { students: [s1, s2], classes: [c1], attendance: [att], makeup: [mk], payments: [pay] };

  it('moves every record into the real tables, identical, with attendance + makeup as sessions', () => {
    makeV0Database(dataDir, v0);
    const store = openStore(dataDir);
    expect(withoutVersion(store.getResource('students'))).toEqual([s1, s2]);
    expect(withoutVersion(store.getResource('classes'))).toEqual([c1]);
    expect(withoutVersion(store.getResource('sessions'))).toEqual(expect.arrayContaining([att, mk]));
    expect(store.getResource('sessions')).toHaveLength(2);
    expect(withoutVersion(store.getResource('payments'))).toEqual([pay]);
    expect(store.getResource('students').every((s) => s._version === 1)).toBe(true);
    store.close();
  });

  it('saves a never-pruned pre-upgrade copy first, and leaves the old table in place', () => {
    makeV0Database(dataDir, v0);
    openStore(dataDir).close();

    const backups = fs.readdirSync(path.join(dataDir, 'backups'));
    const pre = backups.find((f) => f.startsWith('pre-migration-v'));
    expect(pre).toBeTruthy();
    const snap = new DatabaseSync(path.join(dataDir, 'backups', pre), { readOnly: true });
    expect(snap.prepare('SELECT COUNT(*) AS n FROM records').get().n).toBe(6);
    snap.close();

    expect(inspect(dataDir, 'SELECT COUNT(*) AS n FROM records')[0].n).toBe(6);
  });

  it('only upgrades once -- reopening does not duplicate or redo anything', async () => {
    makeV0Database(dataDir, v0);
    const store1 = openStore(dataDir);
    await store1.putRecord('students', 's1', { ...s1, name: 'Changed after upgrade' }, 1);
    store1.close();

    const store2 = openStore(dataDir);
    expect(store2.getResource('students')).toHaveLength(2);
    expect(store2.getResource('students')[0].name).toBe('Changed after upgrade');
    store2.close();
    expect(fs.readdirSync(path.join(dataDir, 'backups')).filter((f) => f.startsWith('pre-migration'))).toHaveLength(1);
  });

  it('refuses to upgrade -- and changes nothing -- if a link is broken', () => {
    makeV0Database(dataDir, { ...v0, classes: [klass('c1', ['s1', 'missing-student'])] });
    expect(() => openStore(dataDir)).toThrow(/upgrade stopped, nothing was changed/i);

    expect(inspect(dataDir, 'PRAGMA user_version')[0].user_version).toBe(0);
    expect(inspect(dataDir, 'SELECT COUNT(*) AS n FROM records')[0].n).toBe(6);
    const tables = inspect(dataDir, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    expect(tables).toEqual(['records']);
  });

  it('refuses to upgrade -- and changes nothing -- if a record is malformed', () => {
    const { name, ...noName } = s1;
    makeV0Database(dataDir, { ...v0, students: [noName, s2] });
    expect(() => openStore(dataDir)).toThrow(/nothing was changed/i);
    expect(inspect(dataDir, 'PRAGMA user_version')[0].user_version).toBe(0);
  });

  it('refuses to upgrade anything it could not store exactly (an explicit null, an unknown slot field)', () => {
    makeV0Database(dataDir, { ...v0, students: [{ ...s1, notes: null }, s2] });
    expect(() => openStore(dataDir)).toThrow(/nothing was changed/i);
    expect(inspect(dataDir, 'PRAGMA user_version')[0].user_version).toBe(0);

    fs.rmSync(path.join(dataDir, 'tutoring.db'));
    fs.rmSync(path.join(dataDir, 'backups'), { recursive: true, force: true });
    const withRoom = klass('c1', ['s1', 's2'], { schedule: [{ dayOfWeek: 2, startTime: '16:00', durationMinutes: 60, room: 'A' }] });
    makeV0Database(dataDir, { ...v0, classes: [withRoom] });
    expect(() => openStore(dataDir)).toThrow(/Unknown schedule field/);
    expect(inspect(dataDir, 'PRAGMA user_version')[0].user_version).toBe(0);
  });
});

describe('upgrading a v1 database (real tables, before extra time) to v2', () => {
  const { SCHEMA_V1 } = require('../sqlite-store');

  function makeV1Database(dir) {
    const db = new DatabaseSync(path.join(dir, 'tutoring.db'));
    db.exec(SCHEMA_V1);
    db.exec(`
      INSERT INTO students (id, name, grade, parent_name, parent_phone, rate_per_session, active, created_at, version, seq)
        VALUES ('s1', 'Ava', '3', 'Priya', '1555', 30, 1, '2026-09-01', 4, 0);
      INSERT INTO sessions (id, date, start_time, duration_minutes, group_id, is_makeup, created_at, version, seq)
        VALUES ('x', '2026-09-08', '16:00', 60, NULL, 0, '2026-09-08', 2, 0);
      INSERT INTO session_students (session_id, student_id, roster_position, attendance) VALUES ('x', 's1', 0, 'present');
      PRAGMA user_version = 1;
    `);
    db.close();
  }

  it('adds the extra-time column without touching existing data or versions', async () => {
    makeV1Database(dataDir);
    const store = openStore(dataDir);
    expect(store.getResource('students')).toEqual([expect.objectContaining({ id: 's1', name: 'Ava', _version: 4 })]);
    expect(store.getResource('sessions')).toEqual([
      expect.objectContaining({ id: 'x', attendance: { s1: 'present' }, studentIds: ['s1'], _version: 2 }),
    ]);
    expect(store.getResource('sessions')[0].extraMinutes).toBeUndefined();

    // And extra time can now be saved.
    const { _version, ...x } = store.getResource('sessions')[0];
    expect(await store.putRecord('sessions', 'x', { ...x, extraMinutes: { s1: 30 } }, 2)).toEqual({ ok: true, version: 3 });
    expect(store.getResource('sessions')[0].extraMinutes).toEqual({ s1: 30 });
    store.close();

    expect(inspect(dataDir, 'PRAGMA user_version')[0].user_version).toBe(3);
    expect(fs.readdirSync(path.join(dataDir, 'backups')).some((f) => f.startsWith('pre-migration-v3-'))).toBe(true);
  });

  it('refuses to open a database from a newer version of the app', () => {
    makeV1Database(dataDir);
    const db = new DatabaseSync(path.join(dataDir, 'tutoring.db'));
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => openStore(dataDir)).toThrow(/newer than this version/);
  });
});

describe('importing the even older JSON files into a brand-new database', () => {
  it('imports them once, leaving the files untouched', () => {
    fs.writeFileSync(path.join(dataDir, 'students.json'), JSON.stringify([student('a')]));
    fs.writeFileSync(path.join(dataDir, 'attendance.json'), JSON.stringify([session('x', null, ['a'], { a: 'present' })]));
    const store = openStore(dataDir);
    expect(withoutVersion(store.getResource('students'))).toEqual([student('a')]);
    expect(store.getResource('sessions')).toHaveLength(1);
    store.close();
    expect(fs.existsSync(path.join(dataDir, 'students.json'))).toBe(true);
  });

  it('ignores a corrupt legacy file rather than failing to start', () => {
    fs.writeFileSync(path.join(dataDir, 'students.json'), 'not valid json');
    const store = openStore(dataDir);
    expect(store.getResource('students')).toEqual([]);
    store.close();
  });
});
