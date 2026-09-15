// Unit tests for the SQLite data store (server/db/) in isolation -- no HTTP
// involved (that's serve.test.js). Every test opens its own throwaway
// tmp directory; never touches app/production/.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { openStore } = require('../store');

let dataDir;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutoring-store-test-'));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('getResource', () => {
  it('returns an empty array for a resource that has never been written', () => {
    const store = openStore(dataDir);
    expect(store.getResource('students')).toEqual([]);
    store.close();
  });
});

describe('setResource', () => {
  it('round-trips an array, preserving order', async () => {
    const store = openStore(dataDir);
    const records = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cara' }];
    await store.setResource('students', records);
    expect(store.getResource('students')).toEqual(records);
    store.close();
  });

  it('fully replaces the previous array, not merges with it', async () => {
    const store = openStore(dataDir);
    await store.setResource('students', [{ id: 'a' }, { id: 'b' }]);
    await store.setResource('students', [{ id: 'c' }]);
    expect(store.getResource('students')).toEqual([{ id: 'c' }]);
    store.close();
  });

  it('keeps resources isolated from each other', async () => {
    const store = openStore(dataDir);
    await store.setResource('students', [{ id: 'a' }]);
    await store.setResource('classes', [{ id: 'g1' }]);
    expect(store.getResource('students')).toEqual([{ id: 'a' }]);
    expect(store.getResource('classes')).toEqual([{ id: 'g1' }]);
    store.close();
  });

  it('accepts records with arbitrary shapes, not just the app\'s known types', async () => {
    const store = openStore(dataDir);
    const weird = [{ id: 'x', nested: { a: [1, 2, 3] }, marker: 'anything' }];
    await store.setResource('payments', weird);
    expect(store.getResource('payments')).toEqual(weird);
    store.close();
  });

  it('persists to disk -- a new store opened on the same dir sees prior writes', async () => {
    const store1 = openStore(dataDir);
    await store1.setResource('students', [{ id: 'a', name: 'Alice' }]);
    store1.close();

    const store2 = openStore(dataDir);
    expect(store2.getResource('students')).toEqual([{ id: 'a', name: 'Alice' }]);
    store2.close();
  });
});

describe('automatic backups', () => {
  function backupFiles() {
    const backupsDir = path.join(dataDir, 'backups');
    return fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((f) => f.endsWith('.db')) : [];
  }

  it('does not back up on the very first write ever (nothing to snapshot yet)', async () => {
    const store = openStore(dataDir);
    await store.setResource('students', [{ id: 'a' }]);
    expect(backupFiles()).toHaveLength(0);
    store.close();
  });

  it('backs up before the second write, capturing the state before it', async () => {
    const store = openStore(dataDir);
    await store.setResource('students', [{ id: 'a', name: 'v1' }]);
    await store.setResource('students', [{ id: 'a', name: 'v2' }]);

    const files = backupFiles();
    expect(files).toHaveLength(1);

    const { DatabaseSync } = require('node:sqlite');
    const snapshotDb = new DatabaseSync(path.join(dataDir, 'backups', files[0]), { readOnly: true });
    const rows = snapshotDb.prepare('SELECT data FROM records WHERE resource = ?').all('students');
    snapshotDb.close();
    expect(rows.map((r) => JSON.parse(r.data))).toEqual([{ id: 'a', name: 'v1' }]);

    store.close();
  });
});

describe('legacy JSON migration', () => {
  it('imports pre-existing production/*.json files into a brand-new database, once', async () => {
    fs.writeFileSync(path.join(dataDir, 'students.json'), JSON.stringify([{ id: 'a', name: 'Alice' }]));
    fs.writeFileSync(path.join(dataDir, 'payments.json'), JSON.stringify([{ id: 'pay_1', amount: 30 }]));

    const store = openStore(dataDir);
    expect(store.getResource('students')).toEqual([{ id: 'a', name: 'Alice' }]);
    expect(store.getResource('payments')).toEqual([{ id: 'pay_1', amount: 30 }]);
    // Nothing was ever written for this resource, migrated or otherwise.
    expect(store.getResource('classes')).toEqual([]);
    store.close();

    // Original files are left completely untouched, never deleted.
    expect(fs.existsSync(path.join(dataDir, 'students.json'))).toBe(true);
  });

  it('does not re-import on a later open once the database already exists', async () => {
    fs.writeFileSync(path.join(dataDir, 'students.json'), JSON.stringify([{ id: 'a', name: 'Alice' }]));

    const store1 = openStore(dataDir);
    store1.close();

    // Someone (or the app) changes the live data after the migration.
    const store2 = openStore(dataDir);
    await store2.setResource('students', [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Ben' }]);
    store2.close();

    // The stale legacy file is still sitting there, but a third open must
    // not re-import it over the now-different real data.
    const store3 = openStore(dataDir);
    expect(store3.getResource('students')).toEqual([{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Ben' }]);
    store3.close();
  });

  it('ignores a legacy file that is empty or corrupt rather than failing to start', async () => {
    fs.writeFileSync(path.join(dataDir, 'students.json'), 'not valid json');
    fs.writeFileSync(path.join(dataDir, 'classes.json'), JSON.stringify([]));

    const store = openStore(dataDir);
    expect(store.getResource('students')).toEqual([]);
    expect(store.getResource('classes')).toEqual([]);
    store.close();
  });
});
