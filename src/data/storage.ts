import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Loads and saves the app's four kinds of data -- "students", "classes",
// "sessions" (attendance + makeups), "payments" -- so the rest of the app
// never has to think about which platform or server setup it's running
// under.
//
// - Web via `npm run serve` (how the app is really used): the server's
//   database is the source of truth. Saves go one record at a time
//   (PUT/DELETE /api/<resource>/<id>), each carrying the version of that
//   record this device last saw. If another device changed it in the
//   meantime, the server refuses (409) instead of overwriting -- so two
//   devices can never silently wipe out each other's changes.
// - Web with no server (e.g. `expo start --web` during development) and
//   native (Expo Go): the whole list is kept in this device's local
//   storage, as before.
//
// Every save is also written through to local storage on web, so a device
// stays usable for a moment if the server blips -- but the server copy
// wins whenever it's reachable.

export type ResourceName = 'students' | 'classes' | 'sessions' | 'payments';

/**
 * - 'saved': reached the shared server (or native local storage).
 * - 'local-only': there's no server at all (dev mode) -- expected, fine.
 * - 'failed': there IS a server and this save didn't reach it. It'll be
 *   retried with the next save of the same kind of data.
 * - 'conflict': another device changed the same record first; nothing was
 *   overwritten. The caller should reload that resource (reloadResource).
 */
export type SaveOutcome = 'saved' | 'local-only' | 'failed' | 'conflict';

interface HasId {
  id: string;
}

const ACCESS_TOKEN_KEY = 'tutoring_access_token';

// The server accepts the access token via a cookie, but a browser's
// "Add to Home Screen" install on iOS runs in its own isolated storage
// container that doesn't reliably carry over cookies the same way a
// normal tab does. So instead of depending on the cookie for these API
// calls, capture the token from the URL once (it's always there on first
// launch -- see server/serve.js's manifest start_url) and send it
// explicitly on every request, belt-and-suspenders alongside the cookie.
function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) {
      window.localStorage.setItem(ACCESS_TOKEN_KEY, fromUrl);
      return fromUrl;
    }
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAccessToken();
  return { ...(token ? { 'X-Dashboard-Token': token } : {}), ...extra };
}

// Whether an /api call has ever actually succeeded this session. Used to
// tell "there's no server here" (dev mode -- expected, silent fallback to
// local storage is correct) apart from "there IS a server and this save
// didn't reach it" (a real failure worth telling the user about). Only
// ever flips one direction, on purpose.
let serverConfirmedReachable = false;

// The last server version seen for each record ("<resource>/<id>").
const versions = new Map<string, number>();
// Records whose save failed (network blip) -- re-sent with the next save
// of that resource, so a failed write isn't simply forgotten.
const dirty = new Map<ResourceName, Set<string>>();
// Resources where a save hit a conflict: queued saves for them are
// dropped (not sent with stale data) until the resource is reloaded.
const conflicted = new Set<ResourceName>();

// Every server write and conflict-reload goes through this one queue, in
// order -- so a class is never saved before the new student it lists, and
// a reload after a conflict always happens after the saves before it.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const versionKey = (resource: ResourceName, id: string) => `${resource}/${id}`;

// ---------- local storage (dev-mode fallback + web write-through) ----------

async function readLocal(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return AsyncStorage.getItem(key);
}

async function writeLocal(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore (e.g. private browsing quota errors)
    }
    return;
  }
  await AsyncStorage.setItem(key, value);
}

function parseArray<T>(raw: string | null): T[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function loadLocal<T>(resource: ResourceName): Promise<T[]> {
  const stored = parseArray<T>(await readLocal(resource));
  if (stored) return stored;
  // Before sessions were one resource, this device stored them as two
  // separate lists -- read those instead of starting empty.
  if (resource === 'sessions') {
    const attendance = parseArray<T>(await readLocal('attendance')) ?? [];
    const makeup = parseArray<T>(await readLocal('makeup')) ?? [];
    return [...attendance, ...makeup];
  }
  return [];
}

// ---------- loading ----------

async function fetchResource<T extends HasId>(resource: ResourceName): Promise<T[] | null> {
  if (Platform.OS !== 'web') return null;
  try {
    const res = await fetch(`/api/${resource}`, { credentials: 'same-origin', headers: apiHeaders() });
    if (!res.ok) return null;
    const body = await res.json();
    if (!Array.isArray(body)) return null;
    serverConfirmedReachable = true;
    const records = body.map((raw: T & { _version?: number }) => {
      const { _version, ...record } = raw;
      if (typeof _version === 'number') versions.set(versionKey(resource, record.id), _version);
      return record as unknown as T;
    });
    dirty.delete(resource);
    conflicted.delete(resource);
    await writeLocal(resource, JSON.stringify(records));
    return records;
  } catch {
    return null;
  }
}

/** Every record of one resource: from the server if there is one, else
 * from this device's local storage. */
export async function loadResource<T extends HasId>(resource: ResourceName): Promise<T[]> {
  return (await fetchResource<T>(resource)) ?? loadLocal<T>(resource);
}

/** Re-reads a resource from the server after a conflict -- queued behind
 * any saves already in flight, so none of them run afterward with stale
 * data. */
export function reloadResource<T extends HasId>(resource: ResourceName): Promise<T[]> {
  return enqueue(() => loadResource<T>(resource));
}

// ---------- saving ----------

type Operation<T> = { kind: 'put'; id: string; record: T } | { kind: 'delete'; id: string };

/** Which records differ between two versions of a list: new or changed
 * ones become puts, missing ones deletes. `alsoResend` ids (earlier saves
 * that failed) are included even if unchanged since. Pure -- exported for
 * tests. */
export function diffRecords<T extends HasId>(prev: T[], next: T[], alsoResend: Iterable<string> = []): Operation<T>[] {
  const prevById = new Map(prev.map((r) => [r.id, JSON.stringify(r)]));
  const nextById = new Map(next.map((r) => [r.id, r]));
  const ops: Operation<T>[] = [];
  const seen = new Set<string>();

  for (const record of next) {
    if (prevById.get(record.id) !== JSON.stringify(record)) {
      ops.push({ kind: 'put', id: record.id, record });
      seen.add(record.id);
    }
  }
  for (const id of prevById.keys()) {
    if (!nextById.has(id)) {
      ops.push({ kind: 'delete', id });
      seen.add(id);
    }
  }
  for (const id of alsoResend) {
    if (seen.has(id)) continue;
    const record = nextById.get(id);
    ops.push(record ? { kind: 'put', id, record } : { kind: 'delete', id });
  }
  return ops;
}

type SendResult = 'ok' | 'conflict' | 'unreachable';

async function send<T extends HasId>(resource: ResourceName, op: Operation<T>): Promise<SendResult> {
  const key = versionKey(resource, op.id);
  const baseVersion = versions.get(key) ?? null;
  try {
    const res = await fetch(`/api/${resource}/${encodeURIComponent(op.id)}`, {
      method: op.kind === 'put' ? 'PUT' : 'DELETE',
      credentials: 'same-origin',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(op.kind === 'put' ? { record: op.record, baseVersion } : { baseVersion }),
    });
    if (res.status === 409) return 'conflict';
    if (!res.ok) return 'unreachable';
    const body = await res.json(); // throws on a non-JSON reply (e.g. a dev server's HTML) -> unreachable
    serverConfirmedReachable = true;
    if (typeof body.version === 'number') versions.set(key, body.version);
    else versions.delete(key);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

/**
 * Saves whatever changed between `prev` and `next` (the same resource's
 * list before and after an edit). Only the changed records are sent, in
 * order, each with the version this device last saw. Resolves once the
 * save has either reached the server or definitively not.
 */
export function saveChanges<T extends HasId>(resource: ResourceName, prev: T[], next: T[]): Promise<SaveOutcome> {
  const snapshot = JSON.stringify(next);
  // Decided now, not when the queue gets to it, so a later edit can't
  // change what this save meant to send.
  const ops = diffRecords(prev, next, dirty.get(resource) ?? []);

  if (Platform.OS !== 'web') {
    return writeLocal(resource, snapshot).then(() => 'saved' as const);
  }
  void writeLocal(resource, snapshot);
  if (ops.length === 0) return Promise.resolve('saved');

  return enqueue(async () => {
    if (conflicted.has(resource)) return 'conflict' as const;
    const pending = dirty.get(resource) ?? new Set<string>();
    dirty.set(resource, pending);

    for (let i = 0; i < ops.length; i++) {
      const result = await send(resource, ops[i]);
      if (result === 'ok') {
        pending.delete(ops[i].id);
        continue;
      }
      if (result === 'conflict') {
        conflicted.add(resource);
        return 'conflict' as const;
      }
      if (!serverConfirmedReachable) return 'local-only' as const;
      for (const op of ops.slice(i)) pending.add(op.id);
      return 'failed' as const;
    }
    return 'saved' as const;
  });
}

/** Test-only: forget all per-session state (versions, queue, flags). */
export function __resetStorageStateForTests() {
  versions.clear();
  dirty.clear();
  conflicted.clear();
  queue = Promise.resolve();
  serverConfirmedReachable = false;
}
