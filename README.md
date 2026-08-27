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
  absent, you can immediately schedule a one-off makeup session (any date,
  time, or class type) linked back to the missed class.
- **Billing** — pick a month; it totals each student's attended sessions
  (regular + makeup) × their rate. Tap **Send via WhatsApp** to open a
  pre-filled reminder message to the parent — you just hit send. Mark
  payments as paid in full, partial, or unpaid as money comes in.

**Where the data lives depends on how you're running it:**
- Via `npm run serve` (recommended, see below) — all data lives in one file
  on this computer, `server/data.json`. Every device that opens the app
  through this server (your wife's phone, your phone, a browser on this
  computer) reads and writes that same file, so they all show the same
  data. This is also why it survives restarting the server: the file isn't
  touched by starting/stopping the Node process.
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
    storage.ts    talks to the server's /api/data when available, else
                  falls back to on-device storage (see DESIGN.md)
    whatsapp.ts   builds the due-amount message + opens the wa.me link
    date.ts       date/time formatting helpers

server/           the "npm run serve" home-screen-app server (see DESIGN.md)
  serve.js        static file server + token auth + /api/data
  icons/          generated app icons (192/512/apple-touch)
  access-token.txt, data.json   generated at runtime, not committed
```

See [DESIGN.md](./DESIGN.md) for how these pieces talk to each other.
