/**
 * Who can get in: people (users), their role, and the personal access
 * links (tokens) each of their devices uses. Kept in its own database,
 * `control.db`, next to tutoring.db -- separate from the business data on
 * purpose, so that when there's more than one tutoring business (see
 * DESIGN.md's multi-tenant plan) the people/login side doesn't have to
 * move.
 *
 * Tokens are never stored -- only a SHA-256 hash of each. The plain token
 * exists exactly once, in the link handed to the person; reading
 * control.db can't recover anyone's link. A link can be revoked on its
 * own (a lost phone), or a person disabled (all their links stop).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROLES = ['owner', 'tutor'];
const SCHEMA_VERSION = 1;
// Writing "last used" on every request would be needless churn.
const LAST_USED_RESOLUTION_MS = 60 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();

class ControlError extends Error {}

function createControlStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'control.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  if (db.prepare('PRAGMA user_version').get().user_version < SCHEMA_VERSION) {
    db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        role        TEXT NOT NULL CHECK (role IN ('owner', 'tutor')),
        created_at  TEXT NOT NULL,
        disabled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS access_tokens (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL REFERENCES users(id),
        token_hash   TEXT NOT NULL UNIQUE,
        label        TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at   TEXT
      );
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  }

  const userColumns = 'id, name, role, created_at AS createdAt, disabled_at AS disabledAt';

  function hasUsers() {
    return !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  }

  function getUser(id) {
    return db.prepare(`SELECT ${userColumns} FROM users WHERE id = ?`).get(id) ?? null;
  }

  /** By id, or by name (case-insensitive). */
  function findUser(nameOrId) {
    return (
      db.prepare(`SELECT ${userColumns} FROM users WHERE id = ? OR name = ? COLLATE NOCASE`).get(nameOrId, nameOrId) ??
      null
    );
  }

  function addUser(name, role) {
    const clean = String(name ?? '').trim();
    if (!clean) throw new ControlError('A name is required.');
    if (!ROLES.includes(role)) throw new ControlError(`Role must be one of: ${ROLES.join(', ')}.`);
    if (findUser(clean)) throw new ControlError(`There's already someone called "${clean}".`);
    const id = newId('usr');
    db.prepare('INSERT INTO users (id, name, role, created_at) VALUES (?, ?, ?, ?)').run(id, clean, role, now());
    return getUser(id);
  }

  function setRole(userId, role) {
    if (!ROLES.includes(role)) throw new ControlError(`Role must be one of: ${ROLES.join(', ')}.`);
    if (db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId).changes === 0) {
      throw new ControlError('No such person.');
    }
  }

  /** A disabled person's links all stop working; enabling brings back the
   * ones that weren't individually revoked. */
  function setDisabled(userId, disabled) {
    const result = db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(disabled ? now() : null, userId);
    if (result.changes === 0) throw new ControlError('No such person.');
  }

  /** Makes a new personal link for a person. Returns the plain token --
   * the only time it ever exists outside the link itself. */
  function createLink(userId, label) {
    if (!getUser(userId)) throw new ControlError('No such person.');
    const cleanLabel = String(label ?? '').trim() || 'Link';
    const token = newToken();
    const id = newId('lnk');
    db.prepare('INSERT INTO access_tokens (id, user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      userId,
      hashToken(token),
      cleanLabel,
      now(),
    );
    return { id, token, label: cleanLabel };
  }

  function revokeLink(linkId) {
    const result = db
      .prepare('UPDATE access_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now(), linkId);
    if (result.changes === 0) throw new ControlError('No such active link.');
  }

  /** Who a token belongs to, or null (unknown, revoked, or the person is
   * disabled). Records when each link was last used. */
  function authenticate(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null;
    const row = db
      .prepare(
        `SELECT t.id AS linkId, t.label, t.last_used_at AS lastUsedAt, u.id, u.name, u.role
         FROM access_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled_at IS NULL`,
      )
      .get(hashToken(token));
    if (!row) return null;
    if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > LAST_USED_RESOLUTION_MS) {
      db.prepare('UPDATE access_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.linkId);
    }
    return { user: { id: row.id, name: row.name, role: row.role }, linkId: row.linkId, linkLabel: row.label };
  }

  /** Everyone, with their links (no tokens, just labels and dates). */
  function listUsers() {
    const users = db.prepare(`SELECT ${userColumns} FROM users ORDER BY created_at`).all();
    const links = db.prepare(
      `SELECT id, label, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
       FROM access_tokens WHERE user_id = ? ORDER BY created_at`,
    );
    return users.map((u) => ({ ...u, links: links.all(u.id) }));
  }

  /** First run after upgrading from the single shared token: keep it
   * working, as an owner's link, so no phone gets locked out. */
  function importLegacyToken(token) {
    if (hasUsers()) throw new ControlError('People already exist; nothing to import.');
    const user = addUser('Shared link (from before separate logins)', 'owner');
    db.prepare('INSERT INTO access_tokens (id, user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?)').run(
      newId('lnk'),
      user.id,
      hashToken(token),
      'The original shared link -- revoke once everyone has their own',
      now(),
    );
    return user;
  }

  function close() {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // closing anyway
    }
    db.close();
  }

  return {
    hasUsers,
    getUser,
    findUser,
    addUser,
    setRole,
    setDisabled,
    createLink,
    revokeLink,
    authenticate,
    listUsers,
    importLegacyToken,
    close,
  };
}

module.exports = { createControlStore, ControlError, ROLES, hashToken };
