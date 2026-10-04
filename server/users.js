#!/usr/bin/env node
/**
 * Manage who can use the app: people, their role, and each device's
 * personal link. Works whether or not the server is running -- changes
 * (like revoking a lost phone's link) take effect on its very next request.
 *
 *   npm run users                                   list everyone and their links
 *   npm run users -- add "Priya" tutor              add a person (owner | tutor)
 *   npm run users -- link "Priya" "Priya's iPhone"  make a personal link for one device
 *   npm run users -- revoke <link id>               turn one link off (e.g. a lost phone)
 *   npm run users -- role "Priya" owner             change someone's role
 *   npm run users -- disable "Priya"                turn off all of someone's links
 *   npm run users -- enable "Priya"                 turn them back on
 *
 * Roles: owner = everything; tutor = attendance, makeups and rescheduling,
 * can view students/classes, no billing or payments (see permissions.js).
 */

const path = require('path');

const { createControlStore, ControlError, ROLES } = require('./db/control-store');
const { linkUrls } = require('./links');

const DATA_DIR = process.env.TUTORING_DATA_DIR
  ? path.resolve(process.env.TUTORING_DATA_DIR)
  : path.join(__dirname, '..', 'production');
const PORT = Number(process.env.PORT) || 8899;

const day = (iso) => (iso ? iso.slice(0, 10) : 'never');

function list(control) {
  const users = control.listUsers();
  if (users.length === 0) {
    console.log('Nobody yet. Start the server once (npm run serve), or: npm run users -- add "Name" owner');
    return;
  }
  for (const u of users) {
    console.log(`${u.name}  (${u.role}${u.disabledAt ? ', DISABLED' : ''})`);
    if (u.links.length === 0) console.log('    no links yet -- npm run users -- link "' + u.name + '" "Their phone"');
    for (const l of u.links) {
      const state = l.revokedAt ? `revoked ${day(l.revokedAt)}` : `last used ${day(l.lastUsedAt)}`;
      console.log(`    ${l.id}  ${l.label}  -- made ${day(l.createdAt)}, ${state}`);
    }
  }
}

function requireUser(control, name) {
  const user = control.findUser(name ?? '');
  if (!user) throw new ControlError(`No one called "${name}". See: npm run users`);
  return user;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const control = createControlStore(DATA_DIR);
  try {
    switch (command) {
      case undefined:
      case 'list':
        list(control);
        break;
      case 'add': {
        const [name, role] = args;
        if (!name || !role) throw new ControlError(`Usage: npm run users -- add "Name" <${ROLES.join('|')}>`);
        const user = control.addUser(name, role);
        console.log(`Added ${user.name} (${user.role}). Next: npm run users -- link "${user.name}" "Their phone"`);
        break;
      }
      case 'link': {
        const [name, label] = args;
        if (!name || !label) throw new ControlError('Usage: npm run users -- link "Name" "Which device, e.g. Priya\'s iPhone"');
        const user = requireUser(control, name);
        const link = control.createLink(user.id, label);
        console.log(`Personal link for ${user.name} -- "${link.label}" (${link.id}):\n`);
        for (const { where, url } of linkUrls(link.token, PORT)) console.log(`  ${where}:\n  ${url}\n`);
        console.log('Send it to that person privately. It is shown only now -- it is not stored anywhere.');
        console.log('On their phone: open it once in Safari/Chrome, then "Add to Home Screen".');
        console.log(`Lost the phone? npm run users -- revoke ${link.id}`);
        break;
      }
      case 'revoke': {
        const [linkId] = args;
        if (!linkId) throw new ControlError('Usage: npm run users -- revoke <link id>   (ids are shown by: npm run users)');
        control.revokeLink(linkId);
        console.log(`Link ${linkId} turned off. Anyone using it is signed out on their next action.`);
        break;
      }
      case 'role': {
        const [name, role] = args;
        const user = requireUser(control, name);
        control.setRole(user.id, role);
        console.log(`${user.name} is now ${role}.`);
        break;
      }
      case 'disable':
      case 'enable': {
        const user = requireUser(control, args[0]);
        control.setDisabled(user.id, command === 'disable');
        console.log(`${user.name} ${command === 'disable' ? 'disabled -- all their links are off' : 're-enabled'}.`);
        break;
      }
      default:
        throw new ControlError(`Unknown command "${command}". Commands: list, add, link, revoke, role, disable, enable.`);
    }
  } catch (err) {
    if (!(err instanceof ControlError)) throw err;
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    control.close();
  }
}

main();
