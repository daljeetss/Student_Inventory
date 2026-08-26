# Tutoring Tracker

A private app for tracking students, weekly class schedules, attendance
(including makeup sessions), and monthly billing with a one-tap WhatsApp
reminder to parents.

Built with [Expo](https://expo.dev) (React Native), so the same app runs on
iPhone, Android (Samsung), and the web — with data stored on-device for now
(see "Cross-device sync" below for the optional next step).

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

The icon reopens the app full-screen, already signed in — the token is
remembered (via the link the first time, then a cookie), so nobody has to
type it again. The token itself just keeps this off-limits to anyone else
on the Wi-Fi network who doesn't have the link; it's saved in
`server/access-token.txt` if you ever need to look it up.

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

All data is stored locally on the device (AsyncStorage on phones,
localStorage on web) — nothing leaves the device today.

## Cross-device sync (optional next step)

Right now, each device (your wife's phone, your computer's browser, etc.)
keeps its own separate copy of the data. If you want the same data to show
up everywhere — e.g. mark attendance on the phone during class, then review
billing on the computer later — the next step is wiring up a free Firebase
project (Firestore + Auth) as a shared backend. Ask your assistant to set
this up when you're ready; it takes a Firebase account (free) and a few
config values from the Firebase console.

## Project structure

```
src/
  app/            expo-router screens (file-based routing)
    (tabs)/       the 4 main tabs: Today, Students, Classes, Billing
    student/      add/view/edit a student
    group/        add/view/edit a recurring class
    session/      mark attendance for one class occurrence
  components/     shared UI (buttons, cards, form fields, chip-select)
  data/           the data model, local storage, and business logic
    types.ts      Student / ClassGroup / SessionRecord / Payment shapes
    store.tsx     React context: all reads/writes go through useAppData()
    whatsapp.ts   builds the due-amount message + opens the wa.me link
    date.ts       date/time formatting helpers
```
