/**
 * What each role may do. The server checks these on every data request
 * (serve.js); the app also reads them (GET /api/me) to hide what someone
 * can't use -- but hiding is only a convenience, the server check is the
 * real one.
 *
 * Named "<resource>:<read|write>" -- the same shape OAuth scopes use, so a
 * later move to a real sign-in provider (see DESIGN.md) can carry these
 * permissions in its tokens unchanged.
 */

const ALL = [
  'students:read',
  'students:write',
  'classes:read',
  'classes:write',
  'sessions:read',
  'sessions:write',
  'payments:read',
  'payments:write',
];

const ROLE_PERMISSIONS = {
  // The business owner: everything.
  owner: ALL,
  // Someone who teaches: marks attendance, schedules makeups and
  // reschedules (all "sessions"), and can see students and classes -- but
  // can't change them, and can't see billing or payments at all.
  tutor: ['students:read', 'classes:read', 'sessions:read', 'sessions:write'],
};

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

module.exports = { permissionsFor, can, ALL_PERMISSIONS: ALL };
