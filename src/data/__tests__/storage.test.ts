// Tests for src/data/storage.ts's per-record saving: only changed records
// are sent, each with the version this device last saw; a save based on
// an out-of-date version is refused (and later saves for that resource
// are held back until a reload); a failed save is retried with the next
// one. Runs against a tiny in-memory fake of the server's PUT/DELETE
// contract (see server/db/store.js) -- no network, never production/.

import { Platform } from 'react-native';

// The native module doesn't exist under Jest; this is the library's own
// official in-memory mock (only reached on the non-web code path anyway).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import {
  __resetStorageStateForTests,
  diffRecords,
  loadResource,
  reloadResource,
  saveChanges,
} from '@/data/storage';

type Rec = { id: string; name: string };

// ---------- a fake server, same version rules as server/db/sqlite-store.js ----------

let serverRows: Map<string, { record: Rec; version: number }>;
let requests: { method: string; url: string; body?: { baseVersion?: number | null } }[];
let networkDown: boolean;
let noServer: boolean;

function reply(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function fakeFetch(url: string, init: { method?: string; body?: string } = {}) {
  const method = init.method ?? 'GET';
  const body = init.body ? JSON.parse(init.body) : undefined;
  requests.push({ method, url, body });
  if (networkDown) return Promise.reject(new Error('network down'));
  if (noServer) return reply(404, 'not found');

  if (method === 'GET') {
    return reply(200, [...serverRows.values()].map(({ record, version }) => ({ ...record, _version: version })));
  }
  const id = decodeURIComponent(url.split('/').pop()!);
  const row = serverRows.get(id);
  const current = row ? row.version : null;
  if (body.baseVersion !== current) return reply(409, { ok: false, conflict: true, version: current });
  if (method === 'DELETE') {
    serverRows.delete(id);
    return reply(200, { ok: true, version: null });
  }
  const version = (current ?? 0) + 1;
  serverRows.set(id, { record: body.record, version });
  return reply(200, { ok: true, version });
}

/** Another device saving a record directly on the server. */
function otherDeviceSaves(record: Rec) {
  const row = serverRows.get(record.id);
  serverRows.set(record.id, { record, version: (row?.version ?? 0) + 1 });
}

let local: Record<string, string>;
const originalOS = Platform.OS;
const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  __resetStorageStateForTests();
  serverRows = new Map();
  requests = [];
  networkDown = false;
  noServer = false;
  local = {};
  Platform.OS = 'web';
  (globalThis as { window?: unknown }).window = {
    location: { search: '' },
    localStorage: {
      getItem: (k: string) => local[k] ?? null,
      setItem: (k: string, v: string) => {
        local[k] = v;
      },
    },
  };
  (globalThis as { fetch?: unknown }).fetch = jest.fn(fakeFetch);
});

afterEach(() => {
  Platform.OS = originalOS;
  (globalThis as { window?: unknown }).window = originalWindow;
});

const writes = () => requests.filter((r) => r.method !== 'GET');

// ---------- diffRecords ----------

describe('diffRecords', () => {
  const a = { id: 'a', name: 'A' };
  const b = { id: 'b', name: 'B' };

  it('puts new and changed records, deletes missing ones, skips unchanged ones', () => {
    const ops = diffRecords([a, b], [{ id: 'a', name: 'A2' }, { id: 'c', name: 'C' }]);
    expect(ops).toEqual([
      { kind: 'put', id: 'a', record: { id: 'a', name: 'A2' } },
      { kind: 'put', id: 'c', record: { id: 'c', name: 'C' } },
      { kind: 'delete', id: 'b' },
    ]);
  });

  it('returns nothing when nothing changed', () => {
    expect(diffRecords([a, b], [a, b])).toEqual([]);
  });

  it('re-sends earlier failed ids even if unchanged since, without duplicating', () => {
    expect(diffRecords([a, b], [a, b], ['b'])).toEqual([{ kind: 'put', id: 'b', record: b }]);
    expect(diffRecords([a], [{ id: 'a', name: 'A2' }], ['a'])).toHaveLength(1);
    expect(diffRecords([a], [a], ['gone'])).toEqual([{ kind: 'delete', id: 'gone' }]);
  });
});

// ---------- saving through the fake server ----------

describe('saveChanges', () => {
  it('sends only the records that changed, not the whole list', async () => {
    serverRows.set('a', { record: { id: 'a', name: 'A' }, version: 1 });
    serverRows.set('b', { record: { id: 'b', name: 'B' }, version: 1 });
    const loaded = await loadResource<Rec>('students');

    const next = loaded.map((r) => (r.id === 'b' ? { ...r, name: 'B2' } : r));
    expect(await saveChanges('students', loaded, next)).toBe('saved');

    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ method: 'PUT', url: '/api/students/b', body: { baseVersion: 1 } });
    expect(serverRows.get('b')).toEqual({ record: { id: 'b', name: 'B2' }, version: 2 });
  });

  it('tracks the new version after each save, so back-to-back edits both land', async () => {
    const empty: Rec[] = [];
    const v1 = [{ id: 'a', name: 'A' }];
    const v2 = [{ id: 'a', name: 'A2' }];
    const s1 = saveChanges('students', empty, v1); // queued
    const s2 = saveChanges('students', v1, v2); // queued behind it
    expect(await s1).toBe('saved');
    expect(await s2).toBe('saved');
    expect(writes().map((w) => w.body?.baseVersion)).toEqual([null, 1]);
    expect(serverRows.get('a')!.version).toBe(2);
  });

  it('deletes a record that was removed from the list', async () => {
    serverRows.set('a', { record: { id: 'a', name: 'A' }, version: 3 });
    const loaded = await loadResource<Rec>('sessions');
    expect(await saveChanges('sessions', loaded, [])).toBe('saved');
    expect(writes()[0]).toMatchObject({ method: 'DELETE', body: { baseVersion: 3 } });
    expect(serverRows.has('a')).toBe(false);
  });

  it("refuses to overwrite another device's newer save, and holds back later saves until reloaded", async () => {
    serverRows.set('a', { record: { id: 'a', name: 'A' }, version: 1 });
    serverRows.set('b', { record: { id: 'b', name: 'B' }, version: 1 });
    const loaded = await loadResource<Rec>('students');

    otherDeviceSaves({ id: 'a', name: 'A from phone' });

    const mine = loaded.map((r) => (r.id === 'a' ? { ...r, name: 'A from laptop' } : r));
    expect(await saveChanges('students', loaded, mine)).toBe('conflict');
    expect(serverRows.get('a')!.record.name).toBe('A from phone'); // not overwritten

    // A later edit to a *different* record, still based on the stale
    // list, is held back rather than sent.
    const writesBefore = writes().length;
    const later = mine.map((r) => (r.id === 'b' ? { ...r, name: 'B2' } : r));
    expect(await saveChanges('students', mine, later)).toBe('conflict');
    expect(writes()).toHaveLength(writesBefore);

    // After reloading, this device sees the phone's change and can save again.
    const fresh = await reloadResource<Rec>('students');
    expect(fresh.find((r) => r.id === 'a')!.name).toBe('A from phone');
    const edited = fresh.map((r) => (r.id === 'b' ? { ...r, name: 'B2' } : r));
    expect(await saveChanges('students', fresh, edited)).toBe('saved');
    expect(serverRows.get('b')!.record.name).toBe('B2');
  });

  it('refuses to re-create a record another device deleted', async () => {
    serverRows.set('a', { record: { id: 'a', name: 'A' }, version: 1 });
    const loaded = await loadResource<Rec>('payments');
    serverRows.delete('a');
    expect(await saveChanges('payments', loaded, [{ id: 'a', name: 'A2' }])).toBe('conflict');
    expect(serverRows.has('a')).toBe(false);
  });

  it('reports a failed save once the server is known, and re-sends it with the next save', async () => {
    await loadResource<Rec>('students'); // server reached
    networkDown = true;
    expect(await saveChanges('students', [], [{ id: 'a', name: 'A' }])).toBe('failed');
    expect(serverRows.has('a')).toBe(false);

    networkDown = false;
    const withB = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    expect(await saveChanges('students', [{ id: 'a', name: 'A' }], withB)).toBe('saved');
    expect(serverRows.has('a')).toBe(true); // the earlier failed save made it this time
    expect(serverRows.has('b')).toBe(true);
  });

  it('falls back to local-only storage when there is no server at all (dev mode)', async () => {
    noServer = true;
    expect(await saveChanges('students', [], [{ id: 'a', name: 'A' }])).toBe('local-only');
    expect(JSON.parse(local.students)).toEqual([{ id: 'a', name: 'A' }]);
    expect(await loadResource<Rec>('students')).toEqual([{ id: 'a', name: 'A' }]);
  });

  it('reads sessions saved on this device before they were one list', async () => {
    noServer = true;
    local.attendance = JSON.stringify([{ id: 'att', name: 'regular' }]);
    local.makeup = JSON.stringify([{ id: 'mk', name: 'makeup' }]);
    expect((await loadResource<Rec>('sessions')).map((r) => r.id)).toEqual(['att', 'mk']);
  });
});
