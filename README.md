# gym-plan

**Live: <https://jsantam.github.io/gym-plan/>**

A workout tracker for my 5 day plan. Static PWA, no backend, no login, no
account. Everything is stored on the phone that logs it.

## What it does

- **Today** opens on the day matching the weekday, with tabs for all five
  days. Each exercise shows the photo, sets and reps, what it works, a
  how-to panel, and a rest timer.
- **Per-set logging.** Every set records its own weight and reps. Tapping a
  set fills it in from what is already entered above it, then from the same
  set last time, then from the top of the rep range — so an ordinary
  session needs no typing.
- **History** lists every past session, newest first, down to the sets.
- **Summary** rolls those records up per exercise: sessions, sets, reps,
  best weight, and the change from the first logged session to the latest.
- **Settings** exports the whole history as JSON and imports it back.
- Works fully offline after the first load, and installs to the home screen.

## Adding it to the iPhone home screen

1. Open the site in **Safari** (not Chrome — only Safari can install a web
   app on iOS).
2. Tap the **Share** button, the square with the arrow.
3. Scroll down and tap **Add to Home Screen**.
4. Name it and tap **Add**.

Launch it from that icon and it runs full screen with no browser chrome.
Open it once on wifi before the first gym session so the service worker can
cache the photos.

## Updating the plan

The plan lives in [`src/plan.js`](src/plan.js) — five days, each with an
exercise list. Edit that file and push; the deploy runs itself.

Each exercise is:

```js
{
  id: "matrix-chest-press",   // stable key: history is stored against this
  name: "Matrix chest press",
  sets: 3,
  reps: "8-12",
  works: "Chest, front shoulders, triceps",
  how:  "Sit with the handles at mid-chest height...",
  img:  "press",              // public/img/press.jpg
  eq:   "Multi-press machine, set to chest press",
  yt:   "https://...",
  alt:  ""                    // optional swap if something hurts
}
```

**Do not change an existing `id`.** It is the key every logged session is
filed under, so renaming one orphans that exercise's history. Changing
`name` is safe; the id is what matters. Two days can share an id on purpose
— Leg curl appears on both Lower A and Lower B and aggregates as one lift.

To add a photo, drop it in `public/img/` and set `img` to the filename
without the extension. Then add it to the `ASSETS` list in `sw.js` and bump
`CACHE`, or it will not be available offline.

## Redeploying

Push to `main`. The workflow in `.github/workflows/deploy.yml` publishes to
GitHub Pages on every push — there is no build step, the repo is served
as-is.

**After changing any file, bump `CACHE` in `sw.js`.** The service worker
serves from its cache first, so without a new cache name an installed copy
keeps showing the old version.

```bash
git add -A && git commit -m "..." && git push
```

## Backing up the history

Settings → **Export history** downloads
`gym-plan-history-YYYY-MM-DD.json`. Do this before changing phones or
clearing Safari's data — nothing is stored anywhere but the device.

To restore, Settings → **Import a backup**, and choose *merge* (Cancel at
the prompt). Merge keeps whichever copy of a session is newer, so importing
an old backup can never delete recent work. *Replace* (OK) wipes the device
first, and is for moving to a new phone.

## Layout

```
index.html            app shell and bottom nav
styles.css            all styling
manifest.json         PWA manifest
sw.js                 offline cache; bump CACHE after any change
server.mjs            local preview only, not deployed
src/plan.js           the plan — edit this to change the workout
src/store.js          IndexedDB, falling back to localStorage
src/session.js        session model, prefill, week counter
src/today.js          Today screen
src/history.js        History screen
src/summary.js        Summary screen
src/settings.js       Settings screen
src/timer.js          rest timer, wake lock, beep
public/img/           exercise photos
```

Local preview:

```bash
node server.mjs
```

Then open <http://localhost:5180>. The service worker is deliberately
skipped on localhost so a reload never serves a stale build.

## Stored data

One record per date and day:

```json
{
  "id": "2026-09-03__upper-push",
  "date": "2026-09-03",
  "dayName": "Upper Push",
  "week": 4,
  "exercises": [{
    "exId": "matrix-chest-press",
    "setsTarget": 3,
    "repsTarget": "8-12",
    "sets": [
      { "n": 1, "weight": 95, "reps": 12, "done": true },
      { "n": 2, "weight": 95, "reps": 11, "done": true },
      { "n": 3, "weight": 95, "reps": 9,  "done": true }
    ],
    "addWeightNextTime": true
  }]
}
```

Weights are numbers when numeric, so free text such as `BW` still works on
chin-ups. Sessions with no completed set are ignored everywhere — opening a
day does not count as training it.
