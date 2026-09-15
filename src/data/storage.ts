import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// A tiny key/value abstraction so the rest of the app never has to think
// about which platform or server setup it's running under. `key` here is a
// resource name -- "students", "classes", "attendance", "makeup", or
// "payments" -- one independent value per entity type, never one combined
// blob (see server/serve.js and DESIGN.md for why: a bad write to one
// entity must never be able to corrupt or wipe out the others).
//
// - Native (Expo Go / a real build): AsyncStorage, same as always.
// - Web: prefer the server-side `/api/<key>` endpoint (see server/serve.js)
//   so every device pointed at the same server shares one copy of the data,
//   instead of each phone's browser storage holding its own separate,
//   less durable copy. If that endpoint isn't there -- e.g. running via
//   `expo start --web` during development, which has no such route --
//   fall back to localStorage so dev mode keeps working unchanged.
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

// Whether an /api/<resource> call has ever actually succeeded this
// session. Used to tell "there's no server here" (dev mode via `expo
// start --web`, which has no /api routes at all -- expected, silent
// fallback to localStorage is correct) apart from "there IS a server and
// this save didn't reach it" (a real failure worth telling the user
// about, since it means this device's data isn't actually shared/durable
// yet). Only ever flips one direction, on purpose -- once we know a
// server is there, a later failure is a real problem, not a mode switch.
let serverConfirmedReachable = false;

async function apiGet(resource: string): Promise<{ ok: true; value: string } | { ok: false }> {
  try {
    const res = await fetch(`/api/${resource}`, { credentials: 'same-origin', headers: apiHeaders() });
    if (!res.ok) return { ok: false };
    serverConfirmedReachable = true;
    return { ok: true, value: await res.text() };
  } catch {
    return { ok: false };
  }
}

async function apiSet(resource: string, value: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/${resource}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: apiHeaders({ 'Content-Type': 'application/json' }),
      body: value,
    });
    if (res.ok) serverConfirmedReachable = true;
    return res.ok;
  } catch {
    return false;
  }
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    const fromApi = await apiGet(key);
    if (fromApi.ok) return fromApi.value;
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  return AsyncStorage.getItem(key);
}

/** Returns false only when there's a real, known-reachable server that
 * this particular write failed to reach -- never for the expected "no
 * server in dev mode" case, where local-only storage is correct and
 * unremarkable. Callers should treat `false` as worth surfacing to the
 * user; a save that only landed in this device's local storage isn't
 * actually shared with other devices yet. */
export async function setItem(key: string, value: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // Write-through to localStorage too: keeps this device usable the
    // instant the server isn't reachable (e.g. a network blip), even
    // though the server copy is the source of truth whenever it's up.
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // ignore (e.g. private browsing quota errors)
    }
    const ok = await apiSet(key, value);
    return ok || !serverConfirmedReachable;
  }
  await AsyncStorage.setItem(key, value);
  return true;
}
