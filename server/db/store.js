/**
 * The single seam between the HTTP layer (serve.js) and however the data is
 * actually stored. serve.js only ever calls openStore(dataDir) and then
 * .getResource / .setResource / .close on what it gets back -- it has no
 * idea SQLite (or anything else) is involved. That's deliberate: it's what
 * makes the storage backend swappable later (e.g. a Phase 2 cloud-backed
 * store, see DESIGN.md's "Beyond the home Wi-Fi" section) without touching
 * a single line of HTTP/auth/static-file code -- only this file would
 * change, to point at a different implementation.
 *
 * Contract any implementation of this module must satisfy:
 *   getResource(resource: string) -> array
 *     Everything currently saved for that resource, in save order. An
 *     unknown/never-written resource returns [], never throws.
 *   setResource(resource: string, records: array) -> Promise<void>
 *     Replaces the whole array for that resource -- matching the API's
 *     existing "POST the full array" contract (the app always sends the
 *     complete, current array on every save, never a partial patch).
 *   close() -> void
 *     Releases any open resources (called on server shutdown).
 */

const { createSqliteStore } = require('./sqlite-store');

function openStore(dataDir) {
  return createSqliteStore(dataDir);
}

module.exports = { openStore };
