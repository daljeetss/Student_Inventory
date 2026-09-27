/**
 * The single seam between the HTTP layer (serve.js) and however the data is
 * actually stored. serve.js only ever calls openStore(dataDir) and the
 * functions below on what it gets back -- it has no idea SQLite (or
 * anything else) is involved. That's deliberate: it's what makes the
 * storage backend swappable later (e.g. a Phase 2 cloud-hosted database,
 * see DESIGN.md) without touching HTTP/auth/static-file code -- only this
 * file would change, to point at a different implementation.
 *
 * Contract any implementation of this module must satisfy (resources are
 * "students", "classes", "sessions", "payments"):
 *   getResource(resource) -> array
 *     Every record of that resource, each with a `_version` number added.
 *   putRecord(resource, id, record, baseVersion) -> Promise<result>
 *     Creates/updates ONE record -- but only if `baseVersion` matches the
 *     version currently stored (null meaning "I believe it doesn't exist
 *     yet"). Result: { ok: true, version } on success, or
 *     { ok: false, conflict: true, version, current } if another device
 *     saved it first (nothing is written). Throws ValidationError for a
 *     malformed record or a link to something that doesn't exist.
 *   deleteRecord(resource, id, baseVersion) -> Promise<result>
 *     Same version check as putRecord. Already-gone counts as success.
 *   close() -> void
 *     Releases the database (called on server shutdown).
 */

const { createSqliteStore, ValidationError, RESOURCES } = require('./sqlite-store');

function openStore(dataDir) {
  return createSqliteStore(dataDir);
}

module.exports = { openStore, ValidationError, RESOURCES };
