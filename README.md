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

### Option A: home-screen icon via a local token-gated server (recommended)

```
npm run serve
```

This builds the app and starts a small local server, printing something
like:

```
On this computer:  http://localhost:8899/?token=puZty2Ygf-hYJCQyPSfMSw
From your phone:   http://192.168.1.225:8899/?token=puZty2Ygf-hYJCQyPSfMSw
```

1. Make sure the phone is on the **same Wi-Fi network** as this computer.
2. Open the "From your phone" link in Safari (iPhone) or Chrome (Samsung) —
   just once.
3. Add it to the home screen:
   - **iPhone (Safari):** Share button → "Add to Home Screen"
   - **Samsung (Chrome):** ⋮ menu → "Add to Home screen" / "Install app"

The icon reopens the app full-screen, already signed in — the app saves the
token from that first link and re-sends it automatically after that, so
nobody has to type it again. The token itself just keeps this off-limits to
anyone else on the Wi-Fi network who doesn't have the link; it's saved in
`server/access-token.txt` if you ever need to look it up. (See
[DESIGN.md](./DESIGN.md#access-token) for exactly how that works — it's not
just a cookie, deliberately, because those aren't reliable inside an
installed home-screen app.)

Leave the `npm run serve` terminal running (or the Mac awake) while the app
is in use — same as Option B, it's served live from this computer. After
you change the app's code, stop it (Ctrl+C) and run `npm run serve` again
to rebuild before reopening the icon.

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
  number, and their per-session rate.
- **Classes** — set up each recurring weekly class (1-on-1 or group), who's
  in it, and what day/time it meets. The **Today** tab automatically shows
  what's scheduled for any given day based on this.
- **Today** — tap a class to mark each student present/absent. If someone's
  absent, you can immediately schedule a makeup two ways: **join an
  existing class's weekly slot** as a one-time guest (pick the class, pick
  which day/time if it meets more than once a week, and it suggests the
  soonest matching date — with a "use the week after instead" option if
  that one doesn't work), or a fully **custom one-off date/time** for
  anything that doesn't fit an existing slot. Either way it's linked back
  to the missed class, and shows up on the makeup date as its own card
  (e.g. "Tuesday Group (makeup)") alongside that class's regular roster.
  Each class also has
  a **Remind via WhatsApp** button for an on-demand "you have class..."
  nudge — one tap shows every student in the class with their own editable,
  pre-filled message and its own Send button, so a group class's parents
  can each be messaged in a couple of taps instead of one at a time. The
  same button is on the **Classes** tab too, for reminding about a
  recurring class in general rather than one specific day.
- **Billing** — pick a month; it totals each student's attended sessions
  (regular + makeup) × their rate. Tap **Send via WhatsApp** to open a
  pre-filled reminder message to the parent — you just hit send. Mark
  payments as paid in full, partial, or unpaid as money comes in.

**Where the data lives depends on how you're running it:**
- Via `npm run serve` (recommended, see below) — all data lives in the
  `production/` folder on this computer, one file per kind of data
  (students, classes, attendance, makeup, payments — see
  [DESIGN.md](./DESIGN.md) for exactly how). Every device that opens the
  app through this server (your wife's phone, your phone, a browser on this
  computer) reads and writes those same files, so they all show the same
  data. This is also why it survives restarting the server: those files
  aren't touched by starting/stopping the Node process. `production/` is
  automatically backed up before every single save (into
  `production/backups/`) and is never to be used for testing.
- Via Expo Go or `npm run web` (dev mode) — there's no server-side API in
  that mode, so it falls back to on-device storage (AsyncStorage on phones,
  localStorage on web), separate per device. This only matters for active
  development; day-to-day use should go through `npm run serve`.

## Beyond the home Wi-Fi (optional next step)

`npm run serve`'s shared data only works for devices on the same Wi-Fi as
this computer (and only while the computer's awake and the server's
running). If you want it reachable — and staying in sync — from anywhere,
not just at home, the next step is either:
- **Tailscale**, so the phones can reach this same server from any network, or
- a free Firebase project (Firestore + Auth), which moves the data to the
  cloud entirely instead of living on this computer.

Ask your assistant to set either of these up when you're ready.

## Backing up your data off this computer

Everything in `production/` (including its automatic on-disk backups) only
exists on this Mac. If this computer is ever lost, stolen, or its disk
fails, that's gone too. To keep a copy somewhere else:

```
npm run backup
```

This encrypts a copy of your current data (AES-256, via `openssl` — already
built into macOS, nothing to install) and saves it to
`~/Documents/TutoringTrackerBackups/`. You'll be prompted for a passphrase
(typed twice, hidden) — **write it down somewhere safe and separate from
the backup file itself** (a password manager, not a sticky note next to
your laptop). Without that passphrase, the backup can never be opened
again, by you or anyone else — that's the point of encrypting it.

**Uploading it to Google Drive automatically** (one-time setup, a few
minutes, on Google's site):
1. Go to [console.cloud.google.com](https://console.cloud.google.com/projectcreate) and create a new project (any name, e.g. "Tutoring Tracker Backups").
2. With that project selected, open [this link](https://console.cloud.google.com/apis/library/drive.googleapis.com) and click **Enable** (turns on the Google Drive API for this project).
3. Open [the OAuth consent screen page](https://console.cloud.google.com/apis/credentials/consent), choose **External**, fill in an app name + your email in the two email fields, save through the steps, and on the **Test users** step add your own Google account's email (the one that owns the Drive folder).
4. Open [the Credentials page](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID** → Application type **Desktop app** → Create.
5. Copy the **Client ID** and **Client secret** it shows you, then run:
   ```
   GDRIVE_CLIENT_ID=<paste> GDRIVE_CLIENT_SECRET=<paste> npm run gdrive-auth
   ```
   This opens your browser once for you to approve access (only to files
   this app creates — it can never see the rest of your Drive), then saves
   the connection to `server/gdrive-credentials.json` (gitignored — never
   commit it, it grants upload access to your Drive).

Once connected, every `npm run backup` uploads the encrypted file straight
into your Google Drive folder automatically — no more dragging. Until
you've done this setup (or if the upload ever fails), it falls back to
opening the file's Finder location and your Google Drive folder in the
browser so you can drag it over yourself.

Run `npm run backup` periodically (e.g. monthly, or after a big batch of new students).
It captures a snapshot of your students/classes/attendance/makeup/payments
at that moment — not a live sync, so anything entered after your last
backup wouldn't be in it if you ever had to restore.

**To restore from a backup** (this replaces the current `production/`
folder, after safety-copying it first):
```
npm run restore -- ~/Documents/TutoringTrackerBackups/tutoring-backup-<timestamp>.tar.gz.enc
```

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
    storage.ts    talks to the server's /api/<resource> endpoints when
                  available, else falls back to on-device storage
    whatsapp.ts   builds the due-amount/reminder messages + wa.me links
    date.ts       date/time formatting helpers
    __tests__/    unit tests for the above (npm test)

server/           the "npm run serve" home-screen-app server (see DESIGN.md)
  __tests__/      integration tests for serve.js (npm test)
  serve.js        static file server + token auth + /api/<resource>
  backup.sh       npm run backup -- encrypted off-machine backup
  restore.sh      npm run restore -- reverses a backup.sh backup
  gdrive-auth.js  npm run gdrive-auth -- one-time Google Drive connection
  gdrive-upload.js   uploads a backup file, used by backup.sh
  gdrive-credentials.json   generated by gdrive-auth, not committed
  icons/          generated app icons (192/512/apple-touch)
  access-token.txt   generated at runtime, not committed

production/       ALL real data lives here -- never touch for testing.
  students.json, classes.json, attendance.json, makeup.json, payments.json
  backups/        automatic snapshot of the whole folder before every save
```

See [DESIGN.md](./DESIGN.md) for how these pieces talk to each other.
