// Unit tests for control.db (people, roles, personal links). Each test
// gets its own throwaway folder; never touches app/production/.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const { createControlStore, ControlError, hashToken } = require('../control-store');

let dir;
let control;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tutoring-control-test-'));
  control = createControlStore(dir);
});

afterEach(() => {
  control.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('people', () => {
  it('adds people with a role, and finds them by name regardless of case', () => {
    const priya = control.addUser('Priya', 'tutor');
    expect(priya).toMatchObject({ name: 'Priya', role: 'tutor', disabledAt: null });
    expect(control.findUser('priya').id).toBe(priya.id);
    expect(control.findUser(priya.id).name).toBe('Priya');
  });

  it('refuses a duplicate name, a blank name, or an unknown role', () => {
    control.addUser('Priya', 'tutor');
    expect(() => control.addUser('PRIYA', 'owner')).toThrow(ControlError);
    expect(() => control.addUser('  ', 'owner')).toThrow(/name/);
    expect(() => control.addUser('Sam', 'admin')).toThrow(/Role/);
  });
});

describe('personal links', () => {
  it('authenticates a link as its person, and stores only a hash of the token', () => {
    const priya = control.addUser('Priya', 'tutor');
    const { token, id } = control.createLink(priya.id, "Priya's iPhone");

    expect(control.authenticate(token)).toMatchObject({ user: { name: 'Priya', role: 'tutor' }, linkId: id });

    const db = new DatabaseSync(path.join(dir, 'control.db'), { readOnly: true });
    const stored = db.prepare('SELECT token_hash FROM access_tokens').get().token_hash;
    db.close();
    expect(stored).toBe(hashToken(token));
    expect(fs.readFileSync(path.join(dir, 'control.db')).includes(token)).toBe(false);
  });

  it('rejects unknown, empty, and absurdly long tokens', () => {
    expect(control.authenticate('nope')).toBeNull();
    expect(control.authenticate('')).toBeNull();
    expect(control.authenticate(undefined)).toBeNull();
    expect(control.authenticate('x'.repeat(5000))).toBeNull();
  });

  it('a revoked link stops working, without affecting the person\'s other links', () => {
    const priya = control.addUser('Priya', 'tutor');
    const phone = control.createLink(priya.id, 'Phone');
    const laptop = control.createLink(priya.id, 'Laptop');
    control.revokeLink(phone.id);
    expect(control.authenticate(phone.token)).toBeNull();
    expect(control.authenticate(laptop.token)).not.toBeNull();
    expect(() => control.revokeLink(phone.id)).toThrow(ControlError); // already off
  });

  it('disabling a person turns off all their links; enabling brings them back', () => {
    const priya = control.addUser('Priya', 'tutor');
    const { token } = control.createLink(priya.id, 'Phone');
    control.setDisabled(priya.id, true);
    expect(control.authenticate(token)).toBeNull();
    control.setDisabled(priya.id, false);
    expect(control.authenticate(token)).not.toBeNull();
  });

  it('a role change applies to existing links immediately', () => {
    const priya = control.addUser('Priya', 'tutor');
    const { token } = control.createLink(priya.id, 'Phone');
    control.setRole(priya.id, 'owner');
    expect(control.authenticate(token).user.role).toBe('owner');
  });

  it('records when a link was last used', () => {
    const priya = control.addUser('Priya', 'tutor');
    const { token } = control.createLink(priya.id, 'Phone');
    expect(control.listUsers()[0].links[0].lastUsedAt).toBeNull();
    control.authenticate(token);
    expect(control.listUsers()[0].links[0].lastUsedAt).not.toBeNull();
  });
});

describe('importing the old single shared link', () => {
  it('keeps it working as an owner link, labelled for later revoking', () => {
    const user = control.importLegacyToken('the-old-shared-token');
    expect(user.role).toBe('owner');
    expect(control.authenticate('the-old-shared-token')).toMatchObject({ user: { role: 'owner' } });
    expect(control.listUsers()[0].links[0].label).toMatch(/original shared link/i);
  });

  it('only on a fresh control.db', () => {
    control.addUser('Priya', 'owner');
    expect(() => control.importLegacyToken('x')).toThrow(ControlError);
  });
});

it('persists across reopening', () => {
  const priya = control.addUser('Priya', 'tutor');
  const { token } = control.createLink(priya.id, 'Phone');
  control.close();
  control = createControlStore(dir);
  expect(control.authenticate(token).user.name).toBe('Priya');
});
