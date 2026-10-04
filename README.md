# Tutoring Tracker

A private app for tracking students, weekly class schedules, attendance
(including makeup sessions), and monthly billing with a one-tap WhatsApp
reminder to parents.

Built with [Expo](https://expo.dev) (React Native), so the same app runs on
iPhone, Android (Samsung), and the web. When run the recommended way (`npm
run serve`, below), all data lives in one shared file on your computer, so
every device sees the same students/classes/billing. See
[DESIGN.md](./DESIGN.md) for how the pieces fit together.

## Running it

There are two ways to get it onto a phone. **Option A is recommended** —
it installs as a real home-screen icon that opens instantly and doesn't
need any app installed first.

### Option A: home-screen icon via a local server (recommended)

```
npm run serve
```

This builds the app and starts a small server on this Mac. **Everyone gets
their own personal link** (so a lost phone can be cut off on its own, and
the app knows who changed what):

```
npm run users -- add "Priya" tutor                 # once per person: owner or tutor
npm run users -- link "Priya" "Priya's iPhone"     # once per device -- prints the link
```

Then, on that phone:
1. Make sure it's on the **same Wi-Fi** as this Mac (or set up Tailscale, below, to use it anywhere).
2. Open the link in Safari (iPhone) or Chrome (Samsung) — just once.
3. Add it to the home screen:
   - **iPhone (Safari):** Share button → "Add to Home Screen"
   - **Samsung (Chrome):** ⋮ menu → "Add to Home screen" / "Install app"

The icon reopens the app full-screen, already signed in as that person —
the footer says who ("Signed in as Priya (tutor)").

**Roles:**
- **owner** — everything.
- **tutor** — marks attendance, schedules makeups and reschedules; can see
  students and classes but not change them; **no billing or payments** (the
  Billing tab, rates, and payment data are hidden *and* refused by the
  server).

**Managing people** (works whether or not the server is running; changes
apply on the next tap):
```
npm run users                          # everyone, their links, when each was last used
npm run users -- revoke <link id>      # turn off one link (e.g. a lost phone)
npm run users -- role "Priya" owner    # change a role
npm run users -- disable "Priya"       # turn off all of someone's links (enable to undo)
```
Links are only shown once, when made — they aren't stored anywhere (only a
fingerprint of each is). Lost one? Revoke it and make a new one.

*Upgrading from the single shared link:* your old link keeps working (as an
owner) so no phone gets locked out — `npm run serve` prints it. Once
everyone has their own link, revoke it (`npm run users` shows its id,
labelled "The original shared link").

Leave the `npm run serve` terminal running (or the Mac awake) while the app
is in use. After you change the app's code, stop it (Ctrl+C) and run `npm
run serve` again to rebuild before reopening the icon.

### Option B: Expo Go (for active development)

1. Install [Expo Go](https://expo.dev/go) on your phone (App Store / Play Store) — free.
2. From this folder, start the dev server:

   ```
   npm start
   ```

3. A QR code appears in the terminal. Scan it with your phone's camera
   (iPhone) or the Expo Go app's scanner (Android) — the app opens instantly.
   Your phone and computer must be on the same Wi-Fi network.
4. To run it in a browser instead: `npm run web`.

This mode live-reloads as code changes, which makes it better suited to
active development than daily use — leave the `npm start` terminal running
while using the app.

## How it works

- **Students** — add each student with their grade, parent's name/WhatsApp
  number, and their hourly rate. The list is grouped by day and then
  by which class meets that day (a class meeting twice a week shows up
  under both days, same roster), so it reads the way you actually think
  about your week, not an alphabetical list — with "No class scheduled
  yet" and "Inactive" sections at the end for anyone that doesn't fit a
  day. **Billing** groups the same way.
- **Classes** — set up each recurring weekly class (1-on-1 or group), who's
  in it, and what day/time it meets. The list itself is grouped by day too
  (sorted by start time within each day), with "No weekly time set yet"
  and "Inactive" sections at the end. The **Today** tab automatically shows
  what's scheduled for any given day based on this.
- **Today** — tap a class to mark each student present/absent. If someone
  stayed longer than the class, tap **+ 30 min** under their name (as many
  times as needed; **− 30 min** to undo) — that extra time is billed for
  just that student. Then **Save Attendance**, which turns into a greyed-out **✓ Saved** once it's
  actually saved (and back to the normal button the moment you change
  something, so it's never ambiguous whether your latest change is saved).
  If a save can't reach the shared server at all (e.g. no Wi-Fi), you'll
  get a clear warning instead of it just silently not going through — this
  same protection applies to every save in the app, not just attendance.
  If someone's
  absent, you can immediately schedule a makeup two ways: **join an
  existing class's weekly slot** as a one-time guest (pick the class, pick
  which day/time if it meets more than once a week, and it suggests the
  soonest matching date — with a "use the week after instead" option if
  that one doesn't work), or a fully **custom one-off date/time** for
  anything that doesn't fit an existing slot. Either way it's linked back
  to the missed class, and shows up on the new date as its own card
  (e.g. "Tuesday Group (rescheduled)") alongside that class's regular
  roster. You don't have to wait for an absence to use this: **Reschedule
  Students**, on any class (even one that hasn't happened yet), lets you
  proactively move just some of the students to a different time — e.g.
  "2 of the 3 kids in tomorrow's group are doing it today instead, just
  this once." Pick who's moving, then the same join-an-existing-class-or-
  custom-time picker as makeups. Tomorrow's class then correctly shows
  only the student who's still coming then — the moved students don't
  show up twice.
  Each class also has
  a **Remind via WhatsApp** button for an on-demand "you have class..."
  nudge — one tap shows every student in the class with their own editable,
  pre-filled message and its own Send button, so a group class's parents
  can each be messaged in a couple of taps instead of one at a time. The
  same button is on the **Classes** tab too, for reminding about a
  recurring class in general rather than one specific day.
- **Billing** — defaults to the current month, moved one month at a time
  with **← Prev**/**Next →**; it bills each student by **time**: the hours
  they attended (regular + makeup sessions, each at its class length, plus
  any extra time) × their hourly rate — so a 1.5-hour class bills 1.5 hours,
  shown as e.g. "4 sessions · 4.5 hrs × $30.00/hr = $135.00". Changing a
  class's length only affects sessions from then on; already-marked ones
  keep the length they had. A month with nothing attended yet shows
  **Nothing due**, not Paid. To bill several months together instead
  (e.g. someone hasn't paid in a while), tap **2 months**/**3**/**6**/**12**
  under "Combine months" — the totals, WhatsApp reminder, and payment
  actions below all combine across that many months ending at whichever
  one Prev/Next is currently on; switch back to **1 month** any time to
  return to the plain single-month view. Tap **Send via WhatsApp** to see
  the pre-filled reminder message before it goes anywhere — edit it if you
  want, then send when you're ready. Mark payments as paid in full,
  partial, or unpaid as money comes in — in combined mode this applies
  across every month in the range in one go (a partial payment pays down
  the oldest month first, then the next, like paying down a running tab).
  A student with nothing due for the selected period shows no
  reminder/payment actions at all.

**Where the data lives depends on how you're running it:**
- Via `npm run serve` (recommended, see below) — all data lives in one
  SQLite database, `production/tutoring.db`, on this computer (students,
  classes, attendance, makeup, payments — see [DESIGN.md](./DESIGN.md) for
  exactly how). Every device that opens the app through this server (your
  wife's phone, your phone, a browser on this computer) reads and writes
  that same database, so they all show the same data. This is also why it
  survives restarting the server: the database isn't touched by
  starting/stopping the Node process. `production/` is automatically
  backed up before every single save (into `production/backups/`) and is
  never to be used for testing. Saves go one record at a time, and **two
  devices can't overwrite each other**: if your wife's phone and your
  laptop both change the same student/class/attendance, whichever saves
  second is told "Changed on another device" and shown the newer version
  instead of silently replacing it.

  **Upgrading from an older version is automatic.** The first `npm run
  serve` after updating converts the database to its new layout, once,
  saving a copy of the old one first (`production/backups/pre-migration-*.db`,
  never deleted) and checking every record came across identical — if
  anything doesn't match, the server refuses to start and changes nothing.
  The terminal prints how many records were moved. Reload the app on any
  phone that still had it open. (Much older versions that used separate
  `students.json`/`classes.json`/etc. files are imported the same way.)
  `tutoring.db` and `tutoring.db-wal` always belong together — never copy
  or delete one without the other; stop the server with Ctrl+C (or just
  close the terminal) and it tidies the two into one.
- Via Expo Go or `npm run web` (dev mode) — there's no server-side API in
  that mode, so it falls back to on-device storage (AsyncStorage on phones,
  localStorage on web), separate per device. This only matters for active
  development; day-to-day use should go through `npm run serve`.

## Using it away from home Wi-Fi (Tailscale, free)

[Tailscale](https://tailscale.com) makes a private network between your
own devices, so your phones can reach this Mac from anywhere (mobile data,
another Wi-Fi) — and gives the app a proper `https://` address. Free for
up to 3 people. The Mac still needs to be on and running `npm run serve`.

One-time setup (about 15 minutes):
1. **Mac:** install Tailscale from [tailscale.com/download/mac](https://tailscale.com/download/mac)
   (or the Mac App Store), open it, and sign in (Google is fine). Allow the
   VPN configuration when macOS asks.
2. **Turn on HTTPS:** in the [Tailscale admin console → DNS](https://login.tailscale.com/admin/dns),
   make sure **MagicDNS** is on and enable **HTTPS Certificates**.
3. **Point Tailscale at the app** (in Terminal, with `npm run serve` running):
   ```
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8899
   ```
   It prints the address, like `https://your-mac.tail1234.ts.net`. This
   stays on across restarts.
4. **Each phone:** install the Tailscale app (App Store / Play Store) and
   sign in **with the same account** as the Mac.
5. **New links include the Tailscale address automatically** — `npm run
   users -- link ...` prints both a "Home Wi-Fi" and an "Anywhere
   (Tailscale)" link. Use the Anywhere one, and add it to the home screen
   as usual. (Existing home-screen icons point at the Wi-Fi address; make a
   new link to switch.)

Only devices signed into your Tailscale account can reach the app — it is
not on the public internet. Moving the data to the cloud entirely (so the
Mac doesn't have to stay on) is a later step; see DESIGN.md.

## Backing up your data off this computer

Everything in `production/` (including its automatic on-disk backups) only
exists on this Mac. If this computer is ever lost, stolen, or its disk
fails, that's gone too. Set up all three steps below once.

### 1. Choose a backup passphrase

```
npm run backup:passphrase
```

Backups are encrypted (AES-256) with this passphrase, saved in your macOS
Keychain so backups can run on their own. **Also keep it somewhere that
isn't this Mac** — a password manager, or written down somewhere safe. If
the Mac dies, the Keychain dies with it, and without the passphrase no
backup can ever be opened again (by you or anyone — that's the point).

Then make your first backup:
```
npm run backup
```
It saves an encrypted file to `~/Documents/TutoringTrackerBackups/`,
**re-opens it to verify it can actually be restored**, and keeps the newest
60 there.

### 2. Upload to Google Drive automatically (free)

One-time setup on Google's site (about 10 minutes):
1. Go to [console.cloud.google.com](https://console.cloud.google.com/projectcreate) and create a new project (any name, e.g. "Tutoring Tracker Backups").
2. With that project selected, open [this link](https://console.cloud.google.com/apis/library/drive.googleapis.com) and click **Enable** (turns on the Google Drive API for this project).
3. Open [the OAuth consent screen page](https://console.cloud.google.com/apis/credentials/consent), choose **External**, fill in an app name + your email in the two email fields, and save through the steps.
4. **Click "Publish app"** (Publishing status → In production). Skip this and Google cuts the connection off every 7 days, silently breaking automatic uploads. The only access this asks for (`drive.file`: just files this app creates) is classed as non-sensitive, so publishing needs no review — when you approve it in step 6, Google may show an "unverified app" screen: click Advanced → continue, it's your own app.
5. Open [the Credentials page](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID** → Application type **Desktop app** → Create.
6. Copy the **Client ID** and **Client secret** it shows you, then run:
   ```
   GDRIVE_CLIENT_ID=<paste> GDRIVE_CLIENT_SECRET=<paste> npm run gdrive-auth
   ```
   This opens your browser once to approve access (only to files this app
   creates — it can never see the rest of your Drive), then saves the
   connection to `server/gdrive-credentials.json` (gitignored — never commit
   it, it grants upload access to your Drive).

From then on every backup uploads to your Drive folder by itself. Until
it's connected, `npm run backup` opens the file's Finder location and the
Drive folder so you can drag it over yourself.

### 3. Back up automatically every day

```
npm run backup:schedule
```

Runs a backup every day at 9:00 PM (or as soon as the Mac wakes, if it was
asleep) using macOS's own scheduler — nothing to install. It never asks
anything or opens windows; you'll get a Mac notification only if a backup
fails. Results are logged to `~/Library/Logs/tutoring-backup.log`. To check
it works right away: `launchctl kickstart gui/$(id -u)/com.marsarsolutions.tutoring-tracker.backup`,
then `tail ~/Library/Logs/tutoring-backup.log`. Turn it off with
`npm run backup:unschedule`.

### Restoring

```
npm run restore -- ~/Documents/TutoringTrackerBackups/tutoring-backup-<timestamp>.tar.gz.enc
```
Replaces the current `production/` folder — after moving the current one
aside to `production-before-restore-<timestamp>/` first. It tries the
Keychain passphrase, and asks if the backup was made with a different one.
Stop the server first, and start it again afterward.

## Looking at your data directly (SQL)

```
npm run db
```

This copies the current database to a temporary file (safely, even while
the server is running) and opens it in `sqlite3`, the SQLite command line
built into macOS. Because it's a copy, nothing you type can change your
real data. Type `.tables` to list tables, `.schema students` to see a
table's columns, and `.quit` to exit. Or run one query without the prompt:

```
npm run db -- "SELECT name, grade, rate_per_session FROM students ORDER BY name;"
```

The tables are `students`, `classes`, `class_students` (who's in each
class), `class_slots` (weekly times), `sessions` (attendance + makeups),
`session_students` (who was in a session and whether present/absent), and
`payments` — see [DESIGN.md](./DESIGN.md#data-storage-sqlite-behind-a-decoupled-module).
Never edit `production/tutoring.db` directly: changes have to go through
the app so versions and backups stay correct.

## Running the tests

```
npm test
```

This runs the whole automated test suite — the business logic (billing math,
attendance/makeup scheduling, occurrence generation) and the server (auth,
each data endpoint, automatic backups, caching) — and prints a pass/fail
summary. It builds the web app first automatically, so it always tests the
current code. Nothing it does touches `production/` — it always runs
against a fresh, throwaway data folder that gets deleted afterward.

Run this after any code change, before restarting `npm run serve`, to catch
a broken feature before your wife does. `npm run test:watch` re-runs
automatically as you edit, for active development. See
[DESIGN.md](./DESIGN.md#testing) for what's covered and how it's organized.

## Project structure

```
src/
  app/            expo-router screens (file-based routing)
    (tabs)/       the 4 main tabs: Today, Students, Classes, Billing
    student/      add/view/edit a student
    group/        add/view/edit a recurring class
    session/      mark attendance for one class occurrence
  components/     shared UI (buttons, cards, form fields, chip-select)
  data/           the data model, storage, and business logic
    types.ts      Student / ClassGroup / SessionRecord / Payment shapes
    store.tsx     React context: all reads/writes go through useAppData()
    storage.ts    saves only changed records to the server (with
                  version checks), else falls back to on-device storage
    whatsapp.ts   builds the due-amount/reminder messages + wa.me links
    date.ts       date/time formatting helpers
    __tests__/    unit tests for the above (npm test)
  utils/
    alert.ts      cross-platform alert() -- use instead of Alert from
                  'react-native' everywhere (its web version is a no-op)

server/           the "npm run serve" home-screen-app server (see DESIGN.md)
  __tests__/      integration tests for serve.js (npm test)
  serve.js        static file server + per-person login + roles + /api/...
  users.js        npm run users -- people, roles, personal links
  permissions.js  what each role (owner, tutor) may do
  links.js        builds Wi-Fi / Tailscale link URLs
  db/             the data store, decoupled from serve.js (see DESIGN.md)
    store.js        the interface serve.js actually calls
    sqlite-store.js  the SQLite tables, per-record saves + version checks,
                     and the automatic, self-verifying upgrade
    control-store.js people, roles, personal links (control.db)
    snapshot.js      consistent copy of a database, used by backup.sh
    __tests__/       unit tests for the store, no HTTP involved
  backup.sh       npm run backup -- encrypted, self-verifying backup
  backup-passphrase.sh  npm run backup:passphrase -- saves it in Keychain
  backup-schedule.sh    npm run backup:schedule -- daily, via launchd
  restore.sh      npm run restore -- reverses a backup.sh backup
  gdrive-auth.js  npm run gdrive-auth -- one-time Google Drive connection
  gdrive-upload.js   uploads a backup file, used by backup.sh
  gdrive-credentials.json   generated by gdrive-auth, not committed
  icons/          generated app icons (192/512/apple-touch)
  access-token.txt   the old shared link (imported once), not committed

production/       ALL real data lives here -- never touch for testing.
  tutoring.db     SQLite database -- students, classes, sessions,
                  payments tables (see DESIGN.md); tutoring.db-wal
                  holds its most recent saves -- keep the two together
  control.db      people, roles, personal links (fingerprints only)
  backups/        automatic snapshot of the database before every save
```

See [DESIGN.md](./DESIGN.md) for how these pieces talk to each other.

---

Copyright © 2026 Marsar Solutions LLC. All rights reserved. See
[LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
