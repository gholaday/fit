# Fit: Personal Workout & Running App Spec

*Personal, single-user app. v1 spec, October 2026.*

---

## 1. Overview

A phone-only Android app (Expo) that is the **one place for all your fitness**: runs, walks, sprints, treadmill, strength and stretching, organised into Runna-style running plans (5K, 10K, half, base building, speed, heart-rate based) generated from rule-based presets.

### Core principle: plan first, data second
The point of the app is to **keep everything straight and stay on a plan** without juggling several apps and notes. Every planned item can be completed with a single tap, with no recording required. GPS, heart rate, Health Connect imports and stats are **enrichment**: great when present, never required. Nothing in the plan engine, adherence or adaptation logic depends on detailed data.

### Goals
- **Fast and snappy above all:** instant launch to Today, instant taps, smooth everywhere (budgets in §2).
- **One schedule for everything:** today's run, stretch and strength session in one list; check things off as you go.
- **Complete anything with minimal input:** tap "Done" (optionally add minutes, RPE, a note), or "Skipped". Recorded or imported data attaches automatically when it exists.
- Build any workout (walk / run / sprint / mixed / strength / stretch) from steps in under a minute.
- Generate a full running plan from a preset + a few inputs, and have it adapt to missed or moved runs.
- Track simple daily stretching routines (morning / evening) as a checklist with reminders, plus a gentle post-run stretch reminder.
- Set up and log strength workouts simply, using a free bundled exercise library.
- **Runna-style running plans:** race plans (5K, 10K, half) with goal times and race dates, and fitness plans (base building, speed, Zone 2). All share one plan engine and one workout model.
- **Mixed targets within one run:** every step picks its own target (pace, heart rate, effort, or none), so a run can warm up by heart rate, do pace intervals, then sprints by effort.
- **Zone 2 is supported as an option** (heart-rate plans and steps), and it's the first plan used personally, but it isn't the center of the running design.
- Start a run in the app (GPS route, steps and targets on screen) while the Garmin records too; live HR from the watch's Bluetooth broadcast when available, otherwise HR merges in after Health Connect sync. Watch-only or a plain "Done" also work.
- Record outdoor runs reliably with GPS, and treadmill/sprint sessions without it.
- Clear, Runna-like UI: "what am I doing today" is always one tap away.
- Fully offline, local-first; syncs to your own Neon database (via a small sync API) for backup, restore and any future web dashboard.

### Non-goals (v1)
- Watch apps (Wear OS / Garmin Connect IQ). Garmin *data* is in scope via Health Connect (§11).
- Importing historical data (Strava, Hevy)
- Multi-user accounts (cloud sync is single-user, token-based — see §17)
- Social features, multi-user, payments
- iOS polish (should run, not a target)

---

## 2. Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Expo SDK (latest), **dev build** | Expo Go can't run background location |
| Routing | expo-router | Tab + stack layout |
| Storage | expo-sqlite + **Drizzle ORM** | Same ORM as your web stack; migrations via drizzle-kit |
| Styling | NativeWind (Tailwind) | Familiar class syntax |
| State | Zustand | Active-session store; everything durable lives in SQLite |
| GPS | expo-location + expo-task-manager | Background task + Android foreground service |
| Map | react-native-maps (Google) or MapLibre | Route polyline on summary + live map tab |
| Audio cues | expo-speech (TTS) + expo-av audio session | Ducks music, doesn't pause it |
| Haptics | expo-haptics + Vibration API | Patterns for step changes |
| Screen | expo-keep-awake | Optional during runs |
| Notifications | expo-notifications | Plan-day reminders, foreground-service notification |
| Charts | Victory Native (Skia) | Pace, mileage, volume charts |
| Files | expo-file-system + expo-sharing | JSON backup, GPX export |
| Cloud sync | Next.js (App Router route handlers) on Vercel + Neon Postgres (Drizzle pg-core), in the same monorepo | Local-first push/pull sync (§17); token in expo-secure-store |
| Health data | react-native-health-connect (+ Expo config plugin) | Garmin steps, HR and watch workouts via Health Connect (§11) |
| Live heart rate | react-native-ble-plx | BLE Heart Rate Profile from the Garmin's broadcast (or a chest strap), auto-connected on Start, best effort (§7) |
| Icons | phosphor-react-native (MIT) | Regular weight; filled glyphs on activity tiles |
| Monorepo | pnpm workspaces + Turborepo | One repo for app, API and shared packages |

### Repo structure
```
fit/
├─ apps/
│  ├─ mobile/          Expo app (dev build, Android)
│  └─ api/             Next.js on Vercel: /api/sync, future web dashboard
├─ packages/
│  ├─ schema/          Drizzle tables: sqlite-core (mobile) + pg-core (api), shared column definitions, parity test
│  ├─ core/            Pure TS, no React: workout model + DSL parser, plan engine (generation, scheduling,
│  │                   adaptation), zone math (VDOT, HR zones), completion rules, Health Connect matching rules
│  ├─ sync/            Sync protocol types (request/response, zod schemas) shared by client and server
│  └─ exercise-catalog/ Import script: free-exercise-db (pinned) → our schema + overrides → catalog.json + images
├─ turbo.json
└─ pnpm-workspace.yaml
```
- `packages/core` is plain TypeScript with unit tests (Vitest). The plan engine and adaptation rules are the easiest part to get subtly wrong, and they're the most testable when kept out of the UI.
- Expo supports monorepos out of the box (Metro resolves workspace packages automatically in current SDKs); pin React/React Native versions in the mobile app only so the API's React doesn't conflict.
- Vercel project points at `apps/api` as its root directory; Turborepo's `turbo-ignore` skips API deploys when only mobile code changed.
- EAS builds run from `apps/mobile` with the workspace installed.

### Performance (top priority)
Speed and snappiness come before features. If something makes the app feel slow, it doesn't ship until it's fast.

**Budgets** (release build, on your actual phone):

| Metric | Target |
|---|---|
| Cold start to interactive Today | < 1.5 s |
| Warm start / resume | < 300 ms |
| Tap feedback (Done, ✓ set, Start) | < 100 ms, no spinners for local actions |
| Screen transitions, lists, workout player | 60 fps sustained (120 fps on capable screens), no dropped frames on scroll |
| Today / Plan / routine screens | Render from local data in < 50 ms |

**Rules**
- **Local first, network never blocks.** Every screen renders from SQLite. Health Connect import, BLE scanning and Neon sync start *after* first paint and run in the background; results slot in without reflowing what you're looking at.
- **Optimistic writes.** Tapping Done, checking a set, or moving a workout updates the UI instantly; the SQLite write follows.
- **Hermes + New Architecture** (Fabric, TurboModules) on.
- **Lists:** FlashList everywhere (exercise catalog, history, plan weeks). Fixed item heights where possible.
- **Animations** on the UI thread only (Reanimated): countdown rings, progress bars, replay marker, sheet transitions.
- **Re-renders:** Zustand with narrow selectors; memoize row components; live workout timers update only their own text node, not the whole screen.
- **Database:** WAL mode, indices on every query path (date, plan_id, session_id, updated_at, dirty), prepared statements, one query per screen where possible (e.g. a single "today view" query). GPS and HR samples are buffered in memory and written in one transaction every 5 s.
- **Seed data:** the exercise catalog ships as a **prebuilt SQLite file** copied on first launch (instant), not thousands of inserts.
- **Lazy load heavy modules:** map/replay (MapLibre), charts, and the guided players load only when opened. Routes are lazy in expo-router.
- **Images:** expo-image with memory + disk cache, thumbnails sized to the view.
- **Small bundle:** no heavyweight utility libraries (date-fns over moment, no full lodash); check bundle size per milestone.
- **Measure, don't guess:** Flashlight (Android FPS/perf score) and Perfetto traces on release builds at the end of each milestone; any regression past a budget is a blocker.

### Testing (tight and focused)
Test the logic that's easy to get subtly wrong and costly to discover on a run. Nothing else.

**What gets tests (Vitest, in packages):**
- `packages/core`: plan generation, scheduling + adaptation rules, weekly schedule expansion + overrides, DSL parser, VDOT and HR zone math, completion levels, Health Connect match + merge rules, routine duration calc.
- `packages/sync`: last-write-wins, cursor handling, soft deletes, batching.
- `packages/schema`: SQLite/Postgres column parity.
- `packages/exercise-catalog`: mapping of a handful of fixture records, overrides applied.

**How:**
- Small, table-driven tests, one behavior each. Injected clock and fixed dates; no real time, no randomness.
- Plain inputs and outputs; no mocking internals, no snapshot tests.
- Whole suite runs in a few seconds; runs on every PR via Turborepo (only affected packages).

**What doesn't get tests:** UI components, styling, navigation, third-party libraries. Device-dependent behavior (background GPS, BLE broadcast, Health Connect) is covered by a short **manual checklist** run on the phone at each milestone.

---

## 3. Core Concepts

- **Workout** — a reusable template made of **steps** and **repeat blocks**. Has a **kind**: `run`, `strength`, `mobility`, or `mixed`.
- **Step** — one segment: activity (walk / run / sprint / rest / strength set / stretch) + duration/target + cue.
- **Session** — one recorded instance of doing a workout (or a free run). Has a **mode**: `outdoor`, `treadmill`, or `timer`.
- **Plan Preset** — a JSON definition of a training plan (weeks → days → workout templates with relative paces).
- **Plan** — a preset instantiated with your inputs (goal date, days/week, long-run day, paces), producing scheduled **Plan Workouts** on real dates. One run/cardio plan is active at a time.
- **Routine** — a reusable session: a strength routine (Push, Pull, Legs…) or a stretch routine (Morning, Evening…).
- **Weekly schedule** — which workouts and stretch routines happen on which weekdays (Mon Pull, Morning stretch daily…). Repeats every week; set on the Plan tab.
- **Three kinds, three levels of structure:** running has a real plan (presets, progression, adaptation); workouts are exercises on scheduled days; stretches are routines on scheduled days/times. They're independent of each other but shown together on Today and the Plan tab.
- **Pace Profile** — your current training paces, derived from a time trial or race result.

### Completion levels
Every plan workout (run, stretch, strength) ends in one of these. All count equally for the plan, streaks and adherence.

| Level | How | What's stored |
|---|---|---|
| **Done** | One tap on the card (or swipe) | Date/time done |
| **Done + details** | "Done" → optional sheet: minutes, distance, RPE, note | Those fields |
| **Done + data** | Recorded in the app, or a Garmin session imported via Health Connect and linked | Full session (route, HR, splits, sets…) |
| **Skipped** | Tap "Skip", optional reason (sick, busy, sore, other) | Reason |
| **Moved** | Drag to another day | Original + new date |

- A manual "Done" can be **upgraded later**: if a matching Garmin session arrives afterwards, it's attached to the same plan workout (no duplicate).
- **Quick log** for unplanned activity (a bike ride, a hike, a gym class): type, date, minutes, optional note. Shows in history and weekly totals; never affects the plan.
- Stats use whatever exists: weekly minutes and completion counts always work; pace, HR and distance stats only include sessions that have that data.

---

## 4. Workout Model

### Step types

```ts
type Activity = 'walk' | 'run' | 'sprint' | 'rest' | 'strength' | 'stretch';

type Duration =
  | { type: 'time'; seconds: number }
  | { type: 'distance'; meters: number }
  | { type: 'open' }                      // until user taps "next"
  | { type: 'reps' };                     // strength

type Target =
  | { type: 'none' }
  | { type: 'pace_zone'; zone: PaceZone }              // resolved via Pace Profile
  | { type: 'pace_range'; minSecPerKm: number; maxSecPerKm: number }
  | { type: 'hr_zone'; zone: 1 | 2 | 3 | 4 | 5 }        // resolved via HR profile (§7)
  | { type: 'hr_range'; minBpm: number; maxBpm: number }
  | { type: 'hr_max'; maxBpm: number }                  // "under 140 bpm"
  | { type: 'effort'; rpe: number }                    // 1-10, used for sprints
  | { type: 'treadmill'; speedKph: number; inclinePct?: number }
  | { type: 'strength'; exerciseId: string; reps: number; weightKg?: number }
  | { type: 'stretch'; stretchId: string; sides: 'both' | 'none'; reps?: number }; // see §10

type PaceZone = 'easy' | 'steady' | 'tempo' | 'threshold' | 'interval' | 'repetition';

interface Step {
  id: string;
  label?: string;          // "Warm up", "Hill", "Strides"
  activity: Activity;
  duration: Duration;
  target: Target;
  cue?: string;            // optional custom TTS text
}

interface RepeatBlock {
  id: string;
  repeat: number;          // e.g. 6×
  steps: Step[];           // e.g. [sprint 30s, walk 90s]
}

interface Workout {
  id: string;
  name: string;
  kind: 'run' | 'strength' | 'mobility' | 'mixed';
  items: (Step | RepeatBlock)[];
  defaultMode: 'outdoor' | 'treadmill' | 'timer';
  notes?: string;
}
```

### Per-step targets (core rule)
Targets live on **each step**, not on the workout. One run can mix them freely:

| Step | Target type | Example |
|---|---|---|
| Warm up | Heart rate (zone or range) | HR Zone 2, or under 140 bpm |
| Intervals | Pace (zone from Pace Profile, or explicit range) | 4 x 400 m at 7:55-8:15 /mi |
| Tempo | Pace | 20 min at 8:55 /mi |
| Sprints | Effort | 6 x 20 s, all out |
| Recovery | None | 90 s walk |
| Treadmill steps | Speed (+ incline) | 7.4 mph, 1% |

- The builder shows a **target picker per step**: Pace, Heart rate, Effort, None (Speed in treadmill mode). Defaults come from the step type: run steps default to the plan's pace zone, walk and recovery to none, sprints to effort.
- Plan presets set targets per step too, so a 5K plan's intervals are pace-based while its easy runs can be pace or HR (user setting: "Easy runs by pace / by heart rate").
- **The in-run screen follows the current step's target** (§14): HR ring for heart-rate steps, pace ring for pace steps, big countdown for sprints and effort steps, plain timer for no-target steps. Cues follow the step too ("Ease off" for HR, "Pick it up" for pace, countdown beeps for sprints).
- Stats and scoring are per step: time in range for HR steps, pace accuracy for pace steps, completed reps for sprints.

### Rules
- **Sprint steps are always time-based with an effort target.** No GPS pace targets — GPS lags 5–10 s and is useless for 20–60 s efforts.
- Run steps may be time **or** distance based. Distance steps fall back to time-estimates in treadmill mode if speed is unknown.
- Nesting: one level of repeat blocks only (keeps the builder and the player simple).
- **Derived values** shown in the builder: total time, estimated distance (from pace profile), and a colored structure bar.

### Example — run/walk/sprint combo
```
Warm up        walk  5:00
Easy           run   10:00   @ easy
6× [ Sprint    sprint 0:30   @ RPE 9
     Recover   walk   1:30 ]
Cool down      walk  5:00
```

### Builder UX
- Quick-add chips: **Warm up, Run, Walk, Sprint, Repeat, Cool down**.
- Tap a step to edit duration (time/distance toggle) and its **target type** (Pace, Heart rate, Effort, None) and value (zone picker, range, RPE).
- Drag to reorder; swipe to delete; long-press to duplicate.
- Live preview of the colored structure bar at the top.
- "Save as template" vs. "Start now".

---

## 5. Session Recording

### Modes

| Mode | Distance source | Pace source | Map | Use for |
|---|---|---|---|---|
| **Outdoor** | GPS | GPS rolling avg | Yes | Road/trail runs and walks |
| **Treadmill** | speed × time (per step) | entered treadmill speed | No | Treadmill runs |
| **Timer** | none (optional manual) | none | No | Sprint sessions on a track/field, strength, stretching, run/walk without GPS |

A workout's `defaultMode` is pre-selected; you can switch modes on the pre-start screen.

### Outdoor (GPS)
- Location updates: `Accuracy.BestForNavigation`, `timeInterval: 1000`, `distanceInterval: 0`.
- **Filtering:** drop points with accuracy > 25 m; drop jumps implying > 12 m/s; light smoothing (moving average or 1-D Kalman on lat/lng).
- **Pace display:** rolling 20 s window for "current pace"; step average and lap average shown alongside.
- **Auto-pause** (optional): speed < 0.6 m/s for 6 s → pause; resume at > 1.0 m/s. Disabled automatically during walk steps if you set walk auto-pause to "off".
- **GPS warmup:** pre-start screen shows signal quality; "Start" enabled once accuracy < 20 m (with "start anyway").
- **Sprint steps inside an outdoor run:** still record GPS distance, but cueing and targets are time/effort only; pace is shown as step average after the step ends.

### Treadmill
- Pre-start: enter default easy speed (remember last).
- Each step can carry a treadmill target (speed/incline), auto-derived from the step's pace zone (`speedKph = 3600 / secPerKm`), rounded to 0.1.
- During the step: big display of **target speed/incline**, elapsed, remaining.
- Speed adjust buttons (± 0.1 / ± 0.5) if you deviate; distance recalculates from actual entered speed.
- End-of-run: "Treadmill says X km" — optional correction that rescales all step distances proportionally.

### Timer
- No location permission needed.
- Optional manual distance at the end.

### Session lifecycle
`ready → countdown (3-2-1) → active ⇄ paused → finishing → saved | discarded`

- Controls: **Pause/Resume**, **Skip step**, **Lap** (open steps), **Lock screen** (prevent pocket taps), **End**.
- **Crash recovery:** session row with `status='active'` + points flushed to SQLite every 5 s. On app launch, an active session prompts "Resume run?" (resumes timer from stored offsets) or "Save what was recorded".
- Background: elapsed time is computed from timestamps (never from interval ticks), so Doze/throttling can't drift the clock.

### Android requirements
- **Foreground service** via `expo-location` `startLocationUpdatesAsync` with `foregroundService` notification ("Run in progress", with distance and time as separate fields).
- Permissions flow (first run):
  1. Fine location (while using)
  2. Background location ("Allow all the time") — explained screen first
  3. Notifications (Android 13+)
  4. **Battery optimization exemption** — open `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`; show OEM-specific tip for Samsung ("Never sleeping apps").
- **Diagnostics screen** in settings: last GPS fix age, permission states, battery-opt status. Saves hours of debugging.

### Audio & haptic cues
- Audio session: duck other audio, don't interrupt.
- **Step-change cue** (always): "Sprint. Thirty seconds." / "Walk. Ninety seconds."
- **Countdown** in last 3 s of hard steps (beeps).
- **Halfway** cue on steps ≥ 3 min (optional).
- **Split cue** every km/mile: "One mile. Nine twelve. Average pace nine eighteen."
- **Pace nudge** (optional): when 20 s rolling pace is outside target zone for > 30 s: "A little faster" / "Ease off". Max once per 60 s.
- **Haptics:** step change = long-short; final 3 s = three short pulses; finish = long.
- Settings: voice on/off, cue frequency (every split / intervals only / off), units for spoken pace.

### Post-session summary
- Title (auto: "Tuesday Intervals"), date, mode badge.
- Hero stats: distance, time, avg pace, (calories est.).
- Map + route (outdoor) with **Replay** button (see below).
- **Step breakdown** table: each step's planned vs actual (time, distance, avg pace), colored by activity.
- Splits (km or mile), pace chart, elevation (if available).
- RPE (1–10) + notes input.
- If linked to a plan workout: marks it complete and shows "Plan updated" if adaptation kicked in.

### Route map & replay (must-have)
Every outdoor session with GPS data gets a traced route and an animated replay, whether it was recorded on the phone or imported from the watch.

**Static map (on the summary)**
- Route polyline, **colored by** a toggle: pace, heart rate, workout step (walk/run/sprint colors), elevation.
- Start/finish markers, mile (or km) markers, tap a point to see time/pace/HR there.
- Map fits the route; full-screen button.

**Replay (full screen)**
- Animated marker traces the run with a growing trail; camera follows (toggle to "whole route" view).
- **Scrubber** timeline under the map with the workout's colored structure bar, so you can jump to "sprint 4" directly; elevation/pace/HR mini-chart synced to the scrubber.
- **Playback speeds:** 10×, 30×, 60×, 120× (a 40-min run plays in ~40 s at 60×); play/pause, drag to scrub.
- **Live readout** at the marker: elapsed time, distance, pace, HR, current step ("Sprint 3/6"), split.
- Pauses and auto-pauses shown as gaps/markers; long stops collapse during playback.
- Share/export: GPX; screenshot of the colored route (video export is a later nice-to-have).

**Implementation notes**
- Uses the same `track_points` timeline (lat, lng, alt, t, plus HR joined by timestamp). Downsample for drawing (Douglas–Peucker, ~1–2k points), full resolution for readouts.
- Marker animation with Reanimated driving the marker coordinate; trail = polyline sliced to the current index.
- Map renderer: **MapLibre** (free vector tiles, data-driven line colors) preferred over Google Maps for per-segment colors and no API key (resolves the map-provider open question unless you prefer Google's look).

**Where GPS data comes from**
| Source | Route? | Notes |
|---|---|---|
| Phone-recorded run (§5) | ✅ Always | Full-resolution points |
| Garmin run via Health Connect | ⚠️ Unconfirmed | Health Connect has an `ExerciseRoute` type, but it's unclear whether Garmin Connect writes routes to it (it does not write routes to Apple Health). **Check in the Health Connect spike.** |
| GPX/FIT file *(manual fallback)* | ✅ | "Open with Fit" from a downloaded Garmin export, attached to an existing session |

When an imported session has no route, its summary shows the stats without a map and an "Add route from file" action (GPX/FIT exported from Garmin Connect).

---

## 6. Pace Profile

### Source
- **Time trial** workout (built-in): e.g. 1 mile or 5 km all-out, or a 3 km time trial.
- **Manual entry** of a recent race (distance + time).
- **Beginner fallback:** "Can you run 20 min continuously?" No → run/walk plans use effort only until a first trial.

### Calculation — VDOT (Jack Daniels)
For a race of distance *d* (m) in time *t* (min), velocity *v = d / t* (m/min):

```
VO2   = -4.60 + 0.182258·v + 0.000104·v²
%max  = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)
VDOT  = VO2 / %max
```

Training pace for a zone at fraction *f* of VDOT: solve `0.000104·v² + 0.182258·v − (4.60 + f·VDOT) = 0` for *v*, then `secPerKm = 60000 / v`.

| Zone | % of VDOT | Typical use |
|---|---|---|
| easy | 62–70% (use 66% midpoint, show range) | Easy + long runs |
| steady | 75–80% | Marathon-ish / steady |
| tempo | 83–86% | Tempo runs |
| threshold | 86–88% | Cruise intervals |
| interval | 97–100% | 3–5 min reps |
| repetition | 105–110% | 200–400 m reps |
| *sprint* | *effort only (RPE 9–10)* | *10–60 s* |

Walk zone = effort-only ("brisk walk").

### Updating
- Re-test workout scheduled every 4–6 weeks in plans.
- After any session where a **threshold/interval step** averaged faster than target for ≥ 2 sessions → suggest a +1 VDOT bump (prompt, never automatic).
- Profile history kept, so old sessions still show the targets that were active at the time.

---

## 7. Heart Rate Training (including Zone 2)

Heart rate is one of the target types any run step can use (§4). This section covers HR sources, zones, and the Zone 2 plan family. Zone 2 (easy aerobic work held at a low heart rate) is the first plan used personally, so it's described in detail, but it's an option alongside pace-based plans, not the default for running.

### Three ways to do a run (example: a Zone 2 run)

**A. Phone + watch (default)**
The app runs the workout and records GPS. Heart rate comes **live over Bluetooth if the watch is broadcasting**; otherwise it's filled in from Health Connect after the watch syncs. Either way you end up with one session with route + HR.
1. **Today card** shows the target: "Zone 2 Run" with "40 min" and "128-145 bpm" below, alongside today's stretching routines and any strength session.
2. Start a Run activity on the Venu 3 (with "broadcast HR during activity" turned on once in its settings). One-time tip: *also set a heart-rate alert for this range, so the watch buzzes when you drift out.*
3. Tap **Start** in the app. It records GPS in the background (§5) and **automatically looks for the paired HR source** for ~10 s:
   - **Found:** live HR in big type with the Zone 2 gauge and time in zone; HR is saved with the session in real time (`source = ble`).
   - **Not found:** the workout runs without live HR (target range shown instead, small "HR will sync from Garmin" note). The app keeps retrying quietly in the background, so a late broadcast is picked up mid-run.
   - The workout screen always shows: current step (walk / Zone 2 / walk), time remaining, distance, pace, step-change cues and haptics.
4. Finish in the app → summary with **map + replay** right away. The plan workout is marked done.
5. When the watch syncs via Health Connect (§11), its session overlaps the phone session, so it's **merged** rather than imported separately. If live HR was captured, the watch only fills gaps (dropouts); if not, its HR samples become the session's HR. The new-activity modal confirms: "Added Garmin heart rate to Zone 2 Run" (or quietly merges if live HR was complete).

**B. Watch only**
For when you don't carry the phone. Start a Run on the watch, then tap **Done** on the card (optionally minutes/RPE). If the run syncs via Health Connect, the new-activity modal links it to the plan workout and adds HR stats; it has a map only if Garmin writes routes to Health Connect (otherwise GPX/FIT import).

**C. Done, no data**
Tap **Done**. Counts the same for the plan.

HR stats depend on how much heart-rate detail Garmin writes to Health Connect (per-sample vs average only); either way, the plan works the same.

The sections below describe the live-HR details used in mode A when the broadcast is connected.

### Live HR source (Bluetooth, best effort)
- **Bluetooth LE Heart Rate Profile** (standard service `0x180D`, characteristic `0x2A37`) via `react-native-ble-plx`.
- Works with:
  - **Garmin watch HR broadcast** (supported on most Forerunner/fēnix/Venu models: "Broadcast Heart Rate" in the watch's HR settings, or auto-broadcast during an activity on some models).
  - Any BLE chest strap or armband (Polar, Garmin HRM, Wahoo, Coros…).
- **Pairing:** Settings → Heart rate sensor → scan → pick device → remember it. Auto-reconnect at session start; pre-start screen shows "♥ 72 bpm" and the device name "Venu 3" or "No HR sensor".
- **Background:** BLE notifications keep flowing under the session's foreground service. Reconnect automatically on drop; mark gaps in the HR trace.
- **Android permissions:** `BLUETOOTH_SCAN` (with `neverForLocation`) + `BLUETOOTH_CONNECT` on Android 12+.
- **Fallbacks when no live HR:**
  1. **Learned Zone 2 pace.** After a few HR-tracked sessions (live or Health Connect), the app computes the pace (outdoor) or treadmill speed/incline you typically hold in Zone 2 and uses that as the target.
  2. **Effort.** "Conversational pace. You could speak in full sentences." RPE 3–4.
  3. Health Connect HR is still added after the watch syncs (§11), so time-in-zone is computed afterwards even if it couldn't be cued live.

### HR profile & zones
Stored in `hr_profile`, editable in Settings. Zones are computed from one method (user's choice):

| Method | Needs | Zone 2 |
|---|---|---|
| **HR reserve (Karvonen)**, default | Max HR + resting HR (auto from Health Connect, 14-day avg) | RHR + 60–70% × (Max − RHR) |
| **% Max HR** | Max HR | 60–70% of Max |
| **MAF (180 − age)** | Age (+ optional adjustment ±5) | (MAF − 10) to MAF |
| **Lactate threshold** | LTHR (from a 30-min test) | 80–89% of LTHR |
| **Custom** | Manual low/high bpm | As entered |

- **Max HR:** measured (from any session's peak, offered as a suggestion when a new high appears), or estimated `208 − 0.7 × age` with a clear "estimate" label.
- Five zones (Z1-Z5) defined for every method, usable as targets on any step and in stats.
- Profile history kept, so old sessions keep the zones they were recorded with.

### Workout model additions
```ts
// HR target types are part of Target in §4 (hr_zone, hr_range, hr_max).
interface Step {
  ...existing
  hrGuard?: {                 // optional, mainly for Zone 2 steps
    capBpm?: number;          // defaults to top of target zone
    walkWhenAbove?: boolean;  // suggest a walk when HR stays above cap
  };
}
```

### Zone 2 session types
| Type | Shape | Notes |
|---|---|---|
| **Z2 Run** | 5 min walk → N min @ Z2 → 5 min walk | Core session |
| **Z2 Run/Walk** | Continuous, HR-driven | Run until HR hits the cap, walk until it drops ~10 bpm below, repeat. For when Z2 running pace is very slow. Duration-based, not interval-based. |
| **Z2 Walk** | Brisk/incline walk @ Z2 | Treadmill-friendly: target speed + incline instead of pace |
| **Z2 Long** | Longer Z2 run/run-walk | Weekly long aerobic session |
| **Aerobic test** | 30 min @ fixed HR (e.g. middle of Z2), treadmill or flat loop | Measures progress: pace/speed at the same HR (see Progress) |

### In-session Zone 2 experience (when live HR is connected)
- **Primary metric = live HR**, with a horizontal zone gauge (Z1–Z5 bands, Z2 highlighted, a marker at current HR) and **time in zone** for the step.
- Secondary: elapsed/remaining, distance, current pace (or treadmill speed).
- **HR smoothing:** 5-second rolling average for display and cue logic, to avoid jitter.
- **Cues (audio + haptic), with hysteresis so they don't nag:**
  - Above zone for > 20 s: "Heart rate one fifty-two. Ease off." (repeat at most every 60 s)
  - Above cap with `walkWhenAbove`: "Take a walk break."
  - Back in zone after drifting: single soft chime + "Back in zone two."
  - Below zone for > 60 s (optional, off by default): "You can pick it up a little."
  - Every 5 minutes (optional): "Twenty minutes. Ninety-two percent in zone."
- **Run/Walk mode** switches the step pill automatically between RUN and WALK based on HR, and logs each segment.
- **Cardiac drift aware:** HR naturally creeps up over long sessions; cues reference the zone, never pace.

### Post-session (Zone 2, both modes)
- **Time in zone** (minutes + %), zone-distribution bar (Z1–Z5).
- HR chart with the Z2 band shaded; pace overlay.
- **Aerobic decoupling (Pa:HR):** compare pace-to-HR ratio of first half vs second half for steady Z2 sessions ≥ 40 min. < 5% = good aerobic fitness for that duration.
- Run/walk split (for Run/Walk sessions).

### Progress (the cardio-improvement metrics)
- **Pace at Zone 2** trend: average pace (or treadmill speed) while in Z2, per week. The headline metric. Getting faster at the same HR = aerobic base improving.
- **Aerobic test** results over time (pace/speed at the fixed HR).
- **Resting HR** 90-day trend (from Health Connect).
- **Weekly Zone 2 minutes** vs plan target.
- Decoupling trend for long sessions.
- Run/walk ratio trend (more running, less walking at the same HR).

### Zone 2 plan presets
Built on the plan engine (§8). Progression is **minutes in Zone 2 per week**, not distance.

| Preset | Length | Shape |
|---|---|---|
| **Zone 2 Base** | 8 weeks | 3–5 sessions/wk. Starts ~90 min/wk Z2 (3 × 30), builds to ~200 min/wk with one long session (60–75 min). Cutback every 4th week. Aerobic test weeks 1, 4, 8. |
| **Zone 2 Run/Walk Start** | 6 weeks | For when Z2 running is hard to hold. HR-driven run/walk sessions, 25 → 45 min; ends with a re-test and a switch to Zone 2 Base. |
| **Zone 2 Walk** | 4 weeks / ongoing | Brisk/incline walking, treadmill-friendly, 30–60 min. Low-impact on-ramp. |
| **Zone 2 + Speed (80/20)** | 8 weeks | ~80% Z2 minutes, ~20% higher intensity: one short sprint or interval session per week from the Speed presets. |

Preset additions to the format:
```jsonc
"progression": {
  "z2MinutesPerWeek": { "start": 90, "peak": 200, "peakWeek": 7 },
  "longSessionMin":   { "start": 45, "peak": 75 }
},
"retestWeeks": [1, 4, 8],          // aerobic test
"retestWorkout": "aerobic-test-30"
```

Plan rules specific to Zone 2:
- Zone 2 sessions are **not** hard days, so they can sit back to back; long session still gets a day after it that isn't a hard session.
- **Adaptation:** if a week's sessions averaged < 60% time in zone because HR ran high, the next week holds volume instead of progressing and suggests Run/Walk mode. If resting HR is elevated > 7 bpm above its 14-day average (Health Connect), Today shows "Resting HR is up, consider an easy walk or rest."
- Missed Z2 sessions: dropped; minutes are not crammed into the remaining days (max +15 min onto one session).

---

## 8. Plan Engine

### Inputs (plan wizard)
1. Pick preset
2. Goal: race date **or** start date + plan length
3. Days per week (3–6, preset defines allowed range)
4. Preferred days (multi-select) + long-run day
5. Pace source (time trial / race / beginner)
6. Treadmill preference: none / some days / mostly (sets `defaultMode` on generated workouts)
7. Review → generate

### Preset format (JSON)

```jsonc
{
  "id": "half-12wk",
  "name": "Half Marathon", "subtitle": "12 weeks",
  "level": "intermediate",
  "weeks": 12,
  "daysPerWeek": { "min": 3, "max": 5, "default": 4 },
  "cutbackEvery": 4,            // weeks 4, 8 reduce volume
  "taperWeeks": 2,
  "retestWeeks": [6],
  "slots": [
    // roles get assigned to your chosen days; priority decides what survives at fewer days/week
    { "role": "long",     "priority": 1 },
    { "role": "quality",  "priority": 2 },
    { "role": "easy",     "priority": 3 },
    { "role": "quality2", "priority": 4 },
    { "role": "easy2",    "priority": 5 }
  ],
  "progression": {
    "long":     { "type": "distance", "startKm": 8, "peakKm": 19, "peakWeek": 10 },
    "easy":     { "type": "time", "startMin": 30, "peakMin": 50 },
    "quality":  { "rotation": ["tempo", "intervals", "hills"] }
  },
  "templates": {
    "tempo":     { "warm": "10m easy", "main": "{{tempoMin}}m @ tempo", "cool": "10m easy" },
    "intervals": { "warm": "15m easy", "main": "{{reps}}× [ 800m @ interval, 2m walk ]", "cool": "10m easy" },
    "hills":     { "warm": "15m easy", "main": "{{reps}}× [ 60s @ RPE 8, 90s walk ]", "cool": "10m easy" }
  },
  "ramps": { "tempoMin": [15, 30], "reps": [4, 8] }
}
```

- Templates use a tiny DSL (`"6× [ 30s sprint @ RPE 9, 90s walk ]"`) parsed into `Workout.items`. The same parser powers a "quick text entry" in the workout builder.
- Linear progression between start and peak values, with cutback weeks at ~70% volume and taper at 60% → 40%.

### v1 presets
Race plans take a race date, goal time and current fitness (recent race or time trial). Fitness plans take a start date and length. Zone 2 presets are in §7.

| Preset | Weeks | Notes |
|---|---|---|
| **Couch to 5K** | 9 | Run/walk intervals, effort-based, 3 days |
| **5K** | 8 | Intervals and tempo at pace, easy and long runs, taper; goal time drives paces |
| **10K** | 10 | Threshold focus |
| **Half Marathon** | 12 | Long run progression |
| **Base Builder** | open-ended (4-wk cycles) | Mostly easy + strides |
| **Speed Block** | 6 | Sprint + hill sessions, short reps, lots of walk recovery |
| **Walk to Run** | 6 | Walking-heavy on-ramp before C25K |

### Generation algorithm
1. Compute start date (race date − weeks, or chosen start).
2. Select slots by priority up to days/week.
3. Assign roles to chosen weekdays: `long` → long-run day; `quality` slots spread to maximize gap from long run and from each other; `easy` fill remaining.
4. For each week: compute progression values (apply cutback/taper multipliers), render templates → Workouts, resolve paces from Pace Profile, set mode from treadmill preference.
5. Insert re-test sessions in `retestWeeks` (replaces the quality slot).
6. Validate with rules below; persist `plan_workouts`.

### Scheduling rules (always enforced)
- **No back-to-back hard days.** Hard = `quality*`, `long`, `retest`, sprint-heavy.
- Long run never the day before or after a quality day if avoidable.
- Weekly volume change ≤ +10% vs previous non-cutback week (soft check; warn in preview).
- At least one full rest day per week.

### Adaptation rules (rule-based)
Triggered on: plan open (daily), session save, manual move.

| Situation | Action |
|---|---|
| Missed **easy** run | Drop it. No makeup. |
| Missed **quality** run | Move to next free day this week if it doesn't violate hard-day rules; else drop. |
| Missed **long** run | Move to next free day within 2 days if no hard neighbor; else shorten the next long run's increase (repeat this week's distance next week). |
| Missed a **whole week** | Repeat that week (shift rest of plan +1 week) if race date allows; else skip and reduce next week by 20%. |
| Missed **2+ weeks** | Prompt: "Rebuild plan from here?" (regenerates from current week with recent volume as new start). |
| User **moves** a workout to another day | Allow; if it breaks a hard-day rule, show a note + "swap with X?" suggestion (see Moving activities). |
| Session RPE ≥ 9 on an **easy** run (2× in a week) | Suggest slowing easy pace (−1 VDOT for easy zone only). |
| Quality targets beaten consistently | Suggest re-test / VDOT bump. |
| Completed workout on an unscheduled day | Ask "Was this your Thursday tempo?" → link it. |

All adaptations are logged (`plan_events`) and shown as small banners: "Moved Tempo to Friday."

### Moving activities (Runna-style)
Moving anything to another day should take two taps or one drag, and never require editing the plan.

**Ways to move**
- **Drag and drop** on the Plan week view: long-press a card, drag it onto another day (current or next week). Haptic tick on pickup and on each day you hover.
- **Move button** on any activity's sheet (and on Today's cards via long-press): opens a **day picker** for this week and next, each day showing what's already on it.
- **Swap:** dropping onto a day that already has an activity of the same kind offers "Swap with Tempo Run" or "Put both on Thursday".
- **Today shortcut:** "Move to tomorrow" on any not-yet-done card.

**What can move**
- Cardio plan workouts (runs, Zone 2, sprints).
- Scheduled workouts (this occurrence; the weekly schedule is unchanged unless you choose "Change the schedule").
- Stretch routine occurrences.
- Recurring items ask only when it matters: **"Just this time"** (default) or **"Change the schedule"** (e.g. move Legs from Thursday to Friday permanently).

**Rules while moving**
- Moves are always allowed. The app **warns, never blocks**: dropping a hard session next to another hard one shows a small note ("Back-to-back hard days") with a one-tap swap suggestion.
- The plan re-validates after the move. Progression and weekly targets stay on the original week; a workout moved into the next week counts for the week it was planned in.
- **Bigger shifts:** "Shift the rest of this week by a day" and "Push plan back a week" (e.g. travel, sick), from the Plan menu.
- Completed activities can be moved too (to fix the date of something logged on the wrong day).

**Feedback and undo**
- The move is instant (optimistic UI, §2) with a short **Undo** snackbar.
- Recorded in the activity's history as Moved (original and new date, §3); no banner for moves you made yourself.
- If the Garmin activity for a moved workout syncs later, matching uses the new date.

---

## 9. Strength

Hevy-style basics: reusable workouts assigned to weekdays, quick logging with last time's numbers, a rest timer. No programs, PR celebrations or auto-progression in v1.

### Exercise library: our own catalog, seeded from free data
The app never reads a third-party format or host at runtime. A one-time (re-runnable) import turns free data into **our own exercise catalog**, which the app and the database own from then on.

**Source:** **free-exercise-db** (github.com/yuhonas/free-exercise-db): ~870 exercises, released under the Unlicense, so it can be copied, modified and shipped freely. Records include name, level, equipment, primary/secondary muscles, step-by-step instructions, category (strength, stretching, plyometric, cardio, …) and demonstration images.

**Import pipeline** (`packages/exercise-catalog`, run with `pnpm catalog:build`):
1. Fetch a pinned commit of the source JSON (never `main`, so builds are reproducible).
2. **Map to our schema** (§13 `exercises`): our own ULID + stable `slug`, `kind` (strength / stretch / cardio / plyometric), our muscle and equipment enums (normalized from theirs), `tracking` type inferred (barbell/dumbbell → `weight_reps`, bodyweight → `reps`, holds/planks → `time`), `sides` + `default_hold_s` for stretches, `aliases` for search ("RDL", "skull crusher").
3. **Curate:** a small overrides file (`overrides.yaml`) to rename, hide, merge duplicates, fix muscles, or add exercises the source lacks. Overrides survive re-imports. The same package holds our **starter stretch routines** (`routines/*.yaml`, §10), written by us against catalog slugs.
4. **Images:** download once, resize to a thumbnail + a detail size (WebP), store under our own keys. Thumbnails ship in the app; detail images are uploaded to our own storage (Vercel Blob in `apps/api`) and cached on first view.
5. **Output:** `catalog.json` (versioned, e.g. `catalog@2026.10.1`) + image assets. `source_ref` keeps the original id for traceability only.

**Where it lives:**
- **App:** `catalog.json` is bundled; on first launch (or when the bundled `data_version` is newer) it's upserted into the local `exercises` table as `origin = seed`. Your custom exercises (`origin = custom`) and anything you've hidden are never overwritten.
- **Neon:** the same rows sync like any other table (§17), so the catalog plus your custom exercises live in your database.
- Workouts and logs reference exercises by **our** `id`, so renaming or re-importing never breaks history.

**In the app:** search + filter by muscle group, equipment and kind. Add custom exercises anytime (name, muscle, equipment, tracking type, optional note).

### Workouts on a weekly schedule
Workouts are just sets of exercises on days. No programs, rotations or progression logic.
- **Workout** = ordered exercises, each with sets × reps (× weight) targets and an optional rest time, e.g. **Push**, **Pull**, **Legs**. Build from the library in a minute: search → add → set sets/reps. Duplicate to make variations ("Push, dumbbells only").
- **Scheduling** happens on the Plan tab's **Schedule** view (§14): assign workouts to weekdays (Mon Pull, Tue Push, Thu Legs). That repeats every week until you change it.
- Scheduled workouts show on **Today** and in **This week** next to runs and stretches. Move a single occurrence by dragging ("Just this time"), or change the weekday on the schedule.
- Missed workouts are simply missed; nothing reshuffles.

### Logging a workout
- Tap **Start** on today's routine (or start any routine / an empty workout).
- Each exercise shows set rows **prefilled from last time** (weight × reps), with the previous values greyed beside them for reference.
- Tap ✓ per set; edit weight/reps inline; add/remove sets; swap an exercise for this session.
- **Rest timer** auto-starts after a checked set (per-routine default, adjustable; notification + vibration at 0).
- Finish → short summary (duration, sets, volume) and, if you changed weights/reps/exercises, **"Update routine with these values?"**
- Or skip logging and just tap **Done** on the card (completion levels, §3).

### History
- Per-exercise history: previous sessions' sets and a simple best-weight-over-time line.
- Per-routine history: when you last did it and what you lifted.
- Weekly count of strength sessions on Stats.
- *Later, if wanted:* est. 1RM, volume by muscle group, supersets.

---

## 10. Stretching (guided)

Daily habit stretching (morning / evening) with **guided, follow-along sessions** like dedicated stretching apps: each stretch shown with its image and instructions, a timed hold, voice cues, and automatic flow to the next stretch.

### Routines
- A stretch routine is a named list of moves from the catalog (`kind = stretch`) or custom, each with a hold time (or reps for dynamic moves), e.g. **Morning** (cat-cow, hip flexor ×2 sides, hamstring, thoracic rotation) and **Evening** (pigeon ×2, figure-4 ×2, calves, child's pose).
- **Starter routines** ship with the app (authored by us in the catalog package): Morning wake-up, Evening wind-down, Post-run, Hips, Lower back, Desk reset. Duplicate and edit any of them.
- **Schedule:** set on the Plan tab's Schedule view, like workouts: chosen days, slot (morning / evening / any) or a time, optional reminder notification ("Evening stretch", body: "7 moves, 9 min").
- Total duration is calculated (holds × sides + transitions) and shown on the card.

### Guided player (default way to do a routine)
- **Full-screen card per stretch:** catalog image, name, 1–2 line instruction, big **countdown ring** for the hold.
- **Two-sided moves** expand automatically: *Left 30 s → "switch sides" (5 s) → Right 30 s*, with an L/R indicator.
- **Transitions:** short get-ready gap between moves (default 8 s, adjustable) with "Next: Pigeon" preview and image.
- **Voice + haptics:** stretch name on start, "10 seconds", "switch sides", soft chime at the end of each move; works with the screen off and over music (ducks it).
- **Controls:** pause, previous, skip, **+15 s** (stay longer), and an overview list to jump to any move.
- Screen stays awake (you're on the floor, not holding the phone).
- Finish → marks the routine done for today; optional "How did it feel?" (1–5) + note.
- **Quick option:** for days you don't want guidance, tap **Done** on the card, or check off individual moves.

### Post-run reminder
- After finishing or checking off a run, a small card appears: **"Post-run stretch?"** with your post-run routine. Tap to start the guided player, check it off, or dismiss.
- On by default; can be turned off or limited to longer runs. It's a reminder, not a plan item, so ignoring it doesn't affect adherence.

### Stats
- Streak and days-per-week for each routine ("Morning: 5 of 7 this week"), minutes stretched per week.

*Later, if wanted:* multi-week flexibility programs with progressive holds, body-area coverage view.

---

## 11. Health Connect (Garmin data)

Garmin Connect writes natively to Android **Health Connect**: steps, heart rate (resting and during workouts), sleep, calories, workouts/exercise sessions, weight and SpO2. Reading Health Connect gets your Garmin data into the app with no Garmin API, approval or watch code. Garmin-only metrics (Body Battery, Training Status, HRV Status) are not available this way.

**Data path:** Garmin watch → Bluetooth → Garmin Connect app → Health Connect → Fit. Data lands only after the watch syncs, so it can lag minutes to hours. The UI always shows "last synced".

### Library & setup
- `react-native-health-connect` with its Expo config plugin (dev build, already required).
- Android 14+ has Health Connect built in; Android 9–13 needs the Health Connect app from Play (prompt to install if missing).
- Health Connect requires a **permissions-rationale screen** (privacy explanation) registered for `ACTION_SHOW_PERMISSIONS_RATIONALE`; the config plugin wires the intent, we supply a simple screen.
- Onboarding: an optional "Connect Garmin data" step after the location/battery permissions; also reachable from Settings.

### Permissions

| Read | Why |
|---|---|
| `Steps` | Daily step count + trends |
| `HeartRate` | HR during your phone-recorded runs, workout HR |
| `RestingHeartRate` | Daily resting HR trend |
| `ExerciseSession` | Import runs/walks/strength recorded on the watch |
| `Distance`, `ActiveCaloriesBurned` | Session and daily totals |
| `Sleep` *(optional)* | Context for readiness (display only in v1) |

| Write *(optional, off by default)* | Why |
|---|---|
| `ExerciseSession`, `Distance`, `ExerciseRoute` | Share Fit sessions with other apps. Off by default to avoid duplicates if you also record on the watch. |

Background read permission is **not** requested in v1; syncing happens in the foreground.

### Sync
- **When:** on app open, on pull-to-refresh on Today, and right after a session is saved.
- **How:** first sync backfills the last **30 days**; afterwards use the Health Connect **changes API** (`getChanges` with a stored token) for incremental pulls. If the token expires (Health Connect keeps ~30 days of changes), fall back to a 30-day re-read.
- Only records from known origins are imported by default (Garmin Connect package); a setting allows "all sources".

### What the data powers

**1. Daily activity**
- Steps today and resting HR on the **Today** screen (small card under the week strip), with a daily step goal (setting, default 8,000).
- Stats → **Activity** tab: steps per day/week, resting HR trend over 90 days.

**2. Heart rate on phone-recorded sessions**
If you wore the watch during a run recorded in Fit, pull `HeartRate` samples for that session's time window after the watch syncs:
- Avg / max HR on the summary, HR line chart under the pace chart.
- **Per-step avg HR** in the step breakdown (e.g. how high each sprint pushed you).
- A banner on the summary: "Heart rate added from Garmin" (or "Waiting for watch sync" with retry on next open).
- This enables HR zones later (a `heart_rate_zone` Target type) without a BLE strap.

**3. Importing watch-recorded workouts**
Runs, walks, treadmill runs and strength sessions recorded on the Garmin become **external sessions**:
- **Merge with phone sessions (the normal case):** if an external session overlaps a Fit-recorded session by > 50% of its duration, it's merged rather than imported separately. Fit keeps its own GPS route, steps and splits; the watch contributes HR samples (and calories). Timestamps are aligned by absolute time, so a watch started a few seconds early or late is fine. The modal shows "Added Garmin heart rate to …" with an Undo.
- **New-activity modal (Strava-style):** on app open, after the Health Connect sync, any newly detected session pops up a bottom-sheet modal, one per activity (stacked, "1 of 2"):
  - **Header:** activity type icon, date/time, duration, distance, avg HR (whatever Health Connect has), source "Garmin Venu 3".
  - **Match suggestion:** if a pending plan workout fits (same day ±1, compatible type, duration within ±30%), it's pre-selected: "Matches **Zone 2 Run** (today, 40 min)". A picker lists other pending workouts from the last 3 days, plus "Not part of my plan".
  - **Quick edits:** title, activity type (run/walk/treadmill/strength…), RPE, note. If the plan workout was already marked Done manually, the modal says "Attach to the completed Zone 2 Run" instead.
  - **Actions:** **Save** (applies match + edits), **Ignore** (hides it; recoverable in History), **Later** (stays as a badge on Today until handled).
  - Also reachable from a "New activities (2)" chip on Today if dismissed.
  - Saving a match marks the plan workout done and links it (counts for adherence and adaptation rules). "Not part of my plan" saves it as an unplanned session.
  - Settings: auto-match without asking when there's exactly one strong match (off by default).
- Imported sessions show in History with a "Garmin" badge. They have totals (time, distance, calories, avg HR), but no step-by-step breakdown or plan targets, and a route only if one is present.

### Data model additions
```
daily_metrics      date, steps, resting_hr, active_kcal, sleep_min, source, synced_at
external_sessions  id, hc_record_id, origin_package, exercise_type, started_at, ended_at,
                   distance_m, active_kcal, avg_hr, max_hr, has_route,
                   linked_session_id?, linked_plan_workout_id?, status(imported|merged|ignored)
hr_samples         session_id, t_offset_ms, bpm, source(ble|health_connect)
hc_sync_state      key, changes_token, last_synced_at
```

### Settings
- Health Connect status (installed / permissions granted / last synced).
- Toggles: import watch workouts, add HR to my runs, write my sessions to Health Connect.
- Daily step goal.
- "Re-sync last 30 days".

### Limits (v1)
- No live data through Health Connect; watch data only arrives after sync. That's fine for Zone 2 (§7): live HR comes from the watch's Bluetooth broadcast when connected, and Health Connect fills in or backfills HR afterwards.
- No structured workouts on the watch; that needs Garmin's Training API (new access paused) or a Connect IQ app (v2 project).

---

## 12. Stats & History

**Runs**
- Weekly / monthly distance and time (bar chart), with walk vs run vs sprint split.
- Pace trend for easy runs (are easy runs getting faster at the same effort?).
- Personal bests: fastest 1 km, 1 mi, 5 km, 10 km, half (best efforts computed from any outdoor session via sliding window).
- Longest run, streaks (weeks with ≥ N runs).
- Plan adherence: % completed, by week.

**Strength** — see §9.

**Stretching** — see §10.

**Activity** — steps and resting HR from Health Connect, see §11.

**History list** — reverse-chronological sessions (including imported Garmin sessions), filter by kind/mode/source, search by name.

---

## 13. Data Model (SQLite / Drizzle)

```
pace_profiles      id, vdot, source(trial|race|manual), source_detail_json, created_at, is_current
hr_profiles        id, method(hrr|max|maf|lthr|custom), max_hr, max_hr_source(measured|estimated),
                   resting_hr, lthr, age, zones_json, created_at, is_current
hr_devices         id, ble_id, name, last_connected_at
z2_pace_model      week, avg_pace_s_per_km_in_z2, avg_treadmill_kph_in_z2, sample_minutes
exercises          id, slug, name, kind(strength|stretch|cardio|plyometric), muscle_primary, muscles_secondary_json,
                   equipment, tracking(weight_reps|reps|time|distance), level, instructions_json, image_keys_json,
                   sides(both|none), default_hold_s?, aliases_json, origin(seed|custom), source_ref?, data_version,
                   hidden, created_at, updated_at
                   (seed rows come from our own exercise catalog, §9; custom rows are yours)
routines           id, kind(strength|stretch), name, folder?, items_json (exercise_id, sets/reps/weight targets
                   or hold_s/reps, sides, rest_s), notes, origin(starter|custom), created_at, updated_at
weekly_schedule    id, weekday(1-7), routine_id, slot(morning|evening|any)?, time?, reminder, position, active
schedule_overrides id, schedule_id, original_date, new_date? (null = skipped this time)
routine_completions id, routine_id, schedule_id?, date, status(done|skipped), items_done_json?, session_id?
workouts           id, name, kind, default_mode, items_json, notes, is_template, created_at, updated_at
plans              id, preset_id, name, inputs_json, start_date, end_date,
                   status(active|done|abandoned), created_at
quick_logs         id, date, activity_type, minutes, distance_m?, note
plan_workouts      id, plan_id, workout_id, date, week_index, role, status(scheduled|done|missed|skipped|moved),
                   completed_at?, manual_minutes?, manual_distance_m?, manual_rpe?, manual_note?, skip_reason?,
                   session_id, original_date, anchor_plan_workout_id?, anchor_position(pre|post)?
plan_events        id, plan_id, plan_workout_id, type, message, created_at
sessions           id, workout_id?, plan_workout_id?, mode, status(active|saved|discarded),
                   started_at, ended_at, elapsed_ms, paused_ms, distance_m, avg_pace_s_per_km,
                   rpe, notes, pace_profile_id, hr_profile_id, time_in_zone_json, decoupling_pct, summary_json
session_steps      id, session_id, idx, step_json(planned), started_at_offset_ms, ended_at_offset_ms,
                   distance_m, avg_pace_s_per_km, treadmill_speed_kph, skipped
track_points       session_id | external_session_id, t_offset_ms, lat, lng, alt, accuracy, speed, source(phone|health_connect|file)
                   (index on owner id + t; one route per session regardless of source)
strength_sets      id, session_id, exercise_id, set_idx, type, reps, weight_kg, duration_s, completed_at
settings           key, value_json
```

- `items_json` stores the workout structure (versioned with `schemaVersion`).
- `session_steps.step_json` snapshots the planned step so editing a template never rewrites history.
- All IDs are ULIDs (sortable, sync-friendly later).
- Every synced table gets `updated_at` + `deleted_at` (soft delete) + local `dirty` flag; the Neon copy adds `server_seq` (§17).

---

## 14. Screens & Navigation

**Bottom tabs:** Today, Plan, Library, Stats, (Settings via avatar/gear)

**Today day widget**
- Left: **steps ring** toward the daily goal (default 8,000, from Health Connect), steps in the center.
- Right: a headline, a **strip with one segment per item today** (colored by type, filled when done), and one or two plain lines.
- A faint "12m ago" shows when steps last synced; pull down to refresh. Tap opens Activity stats.
- Changes by time of day and day type:
  - **Morning:** "4 things today", the first item and its time, total time for the day.
  - **During the day:** "1 of 4 done" and the next item.
  - **Evening wrap-up** (everything done or after 8 PM): "All done" or "3 of 4 done", the day's highlight (e.g. run distance and % in zone), what's tomorrow. Ring turns sage when the step goal is met.
  - **Rest day:** "Rest day, 1 of 2 done" and the remaining stretch routine.
- Shrinks to a slim bar (steps + done count) as the checklist scrolls.

| Screen | Purpose / key elements |
|---|---|
| **Today** | **Day widget** at the top (see below). **Today's checklist**: every item scheduled today (run/Z2, strength routine, stretch routines) as cards, each with **Done** (one tap, long-press for details) and **Skip**; run cards also have **Start** for in-app recording. Hero card for the main workout: name, structure bar or bpm range, est. time & distance, mode chip. **+ Quick log** button. "Up next" list for the week. Plan progress (week 5 of 12). New-activity modal on open when Garmin sessions arrive (§11), with a "New activities" chip if dismissed. Quick actions: Free run, Treadmill, Strength, Stretch. |
| **Pre-start** | Workout preview (step list), mode toggle (Outdoor/Treadmill/Timer), GPS signal indicator, HR sensor status ("♥ 72 bpm", device name below), voice on/off, **Start**. |
| **In-session (run)** | Current step pill + colored progress bar for whole workout. Giant primary metric (time remaining in step, or distance remaining). Secondary metrics: current pace vs target zone, total time, total distance. Next step preview. Pause / Skip / Lock. Swipe → map. |
| **In-session (treadmill)** | Same layout; primary = target speed/incline; ± speed controls. |
| **In-session (by step target)** | The main gauge follows the current step: **HR ring** (zones, current bpm) for heart-rate steps; **pace ring** (target range band, slower/faster ends, current pace) for pace steps; **sprint view** (full-screen tint, huge countdown, rep dots) for effort steps; plain timer for no-target steps. Secondary stats: left in step, HR or pace, next step. |
| **Run plan manager** | Goal time and race day (race plans), weekly volume chart with cutback and taper weeks, training paces with Re-test, the current week's runs with structure bars. Actions: change days, push back, switch plan. |
| **Run workout builder** | Structure bar, steps and repeat blocks, a target type per step (Pace, Heart rate, Effort, None), quick-add chips. |
| **In-session (strength)** | Hevy-style list: exercises with set rows (previous values greyed beside), ✓ per set, rest timer bar, add/swap exercise, Finish → "Update routine?" |
| **In-session (stretch)** | Guided full-screen card: catalog image, instruction, countdown ring, L/R indicator, next-move preview, voice cues, +15 s / skip / previous. |
| **Summary** | Hero stats, map, step breakdown, splits, HR chart + per-step HR (when watch data is available), RPE + notes, Save. |
| **Plan: This week** | Running plan card (name, week x of y, the plan's weekly measure: miles for race plans, Zone 2 minutes for Zone 2 plans; tap to open the run plan manager). Week navigator. One row per day with three lanes: Run, Workout, Stretch. Long-press and drag any item to another day, or use Move for the day picker; swap when dropping onto an occupied day; Undo snackbar (§8 Moving activities). Banners for automatic run-plan adaptations only. |
| **Plan: Schedule** | Where all repeating setup lives. Running plan card (days, long-run day, Manage: change days, pause, rebuild, push back a week, switch plan). **Every week** list: each weekday shows chips for its run (from the plan, read-only here), workouts and stretch routines with times; tap a day or **+** to add/remove a workout or routine and set a time/reminder. |
| **Plan wizard** | Steps from §8. Final screen previews week 1. |
| **Library** | Your workouts, stretch routines and custom run workouts (filter by kind), starter stretch routines to duplicate, exercise catalog. Create and edit here; scheduling happens on Plan. |
| **Stretch library** | Browse/filter stretches by area and type; add custom. |
| **Workout builder** | §4 builder. |
| **Stats** | Week, month, 3 months. Plan completion by type, the running plan's key trend (pace at Zone 2 for HR plans, time-trial and interval pace for race plans), steps, resting HR. |
| **History** | Session list → Summary. |
| **Settings** | Units, voice/cues, auto-pause, pace profile (view/retest/edit), HR profile & zones, HR sensor pairing, treadmill defaults, Health Connect, permissions & diagnostics, backup/export. |

---

## 15. Design Direction

Runna-inspired, not a copy:
- **Calm palette:** neutral backgrounds and text do most of the work, one restrained accent for primary actions, and a small set of muted activity colors. Color marks *type*, never decoration.
- **Colored structure bar** is the signature element — every workout shows its shape (warm-up, intervals, recovery, cool-down) as proportional colored segments. Used on cards, builder, and in-session progress.
- Activity colors (muted, consistent everywhere): easy running and Zone 2 = dusty blue, walk = grey, strength = soft lavender, stretch = sage, harder efforts (tempo, intervals, sprints) = muted amber/clay, used sparingly. No saturated neons.
- **Huge numerals** in-session (tabular figures), readable at arm's length mid-stride.
- Cards with generous radius, minimal chrome, one primary action per screen.
- Motion: subtle step-change pulse; progress bar fills continuously. Fast and short (150 to 250 ms); motion never delays an action.

### Copy and visual rules
The app should read like a well-made sports tool, not like generated text.
- **No middle-dot separators (·) and no em or en dashes** in UI text. Separate pieces of information with layout (label above value, columns, spacing) or, in a single line, a plain comma.
  - Not: "Zone 2 Run · 40 min · 128–145 bpm"
  - Yes: title "Zone 2 Run", with "40 min" and "128-145 bpm" as separate labeled values below it.
- **Ranges** use a plain hyphen or "to": "128-145 bpm", "Oct 26 to Nov 1".
- **No emoji, no exclamation marks, no cheerleading** ("Great job!", "You crushed it", "Let's go", "Let's get started"). State facts: "Workout saved", "3 of 3 done this week".
- **Sentence case** labels, short and literal: "Start", "Done", "Skip", "Mark done", "Rest timer".
- **Units always shown** with numbers: "40 min", "2.6 mi", "9:12 /mi", "135 lb".
- **No decorative filler:** no gradient washes, glows, sparkle icons, left-border accent cards, or illustrations that don't carry information.
- These rules also apply to notifications, voice cues and empty states.

**Chosen direction: Midnight**, with dark and light themes following the system setting (see Design canvas). 
- **Icons:** Phosphor Icons (MIT), via `phosphor-react-native`, regular weight. Activity icons in tinted tiles identify each item on Today: filled glyphs for run, strength and stretch in the lane color.
- **In-run gauge:** a 270° ring that follows the step target: HR zones for heart-rate steps, a pace band for pace steps; sprint steps switch to a full-screen countdown.
- **Run summary:** route map with Replay, headline stats, time-in-zone bar, and an **HR chart over the whole run with the target band shaded**, plus the post-run stretch card.

---

## 16. Settings, Backup & Export

- **Units:** km / mi (pace and distance), kg / lb.
- **Backup:** cloud sync to Neon is the primary backup (§17). "Export everything" → single JSON (all tables) via share sheet stays as an offline escape hatch; "Import backup" restores.
- **GPX export** per outdoor session.

---

## 17. Cloud Sync (Neon)

The phone stays **local-first**: SQLite is the source of truth for the UI, everything works offline, and sync runs in the background. Neon Postgres holds a full copy for backup, restore on a new phone, and for any web dashboard you build later.

### Architecture
```
Fit app (SQLite)   ──HTTPS──▶ Sync API (Next.js route handlers on Vercel) ──▶ Neon Postgres
                                   apps/api in the monorepo                   schema: fit
```
- **No direct DB connection from the phone.** A connection string in an APK is extractable; the API sits in between and holds the Neon credentials.
- The API is a **small Next.js app in the same monorepo** (`apps/api`), deployed to Vercel: `/api/sync`. Its own Neon project, `fit` Postgres schema. It shares `packages/schema` and `packages/sync` with the mobile app, so the protocol and tables can't drift. A web dashboard can be added to the same app later.
- **Auth (single user):** a long random bearer token, generated once, stored in Vercel env and on the phone in `expo-secure-store` (entered or scanned via QR in Settings). Upgrade to real auth only if the app ever has more users.

### Schema
- **Drizzle on both sides:** `sqlite-core` tables in the app, `pg-core` tables on the server with the same names and columns. Both live in `packages/schema` with a parity test in CI that fails if a column exists on one side only.
- Every synced table already has: **ULID `id`**, `updated_at`, `deleted_at` (soft delete).
- Server adds **`server_seq bigint`**, set from one global Postgres sequence on every insert/update. It's the pull cursor.
- Local adds **`dirty boolean`**, set on every local write, cleared after a successful push.
- **Track points** are stored server-side as **one row per session** in `session_tracks` (`session_id`, encoded polyline + parallel arrays for time/alt/HR, `jsonb` or `bytea`), not one row per point. They're immutable once a session is saved, so they're pushed once, gzipped.
- **Not synced:** settings that are device-specific (paired HR sensor, battery-optimization state, Health Connect change tokens), seed data (stretch/exercise library, presets) except custom entries.

### Protocol
One endpoint, push-then-pull:

```
POST /api/sync
{ "cursor": 18233, "changes": { "plan_workouts": [ {...row} ], "sessions": [...], ... } }

→ { "applied": 12, "conflicts": [], "cursor": 18301,
    "changes": { "plan_workouts": [...], ... } }      // rows with server_seq > client cursor
```
- **Push:** all local rows with `dirty = true`, batched (≤ 500 rows or ≤ 1 MB per request; tracks in their own requests).
- **Apply on server:** upsert by `id` inside one transaction; **last-write-wins by `updated_at`** (single user, rare true conflicts; a row edited on two devices keeps the newer edit). Older incoming rows are skipped and returned in `conflicts` for logging.
- **Pull:** server returns rows changed since the client's cursor (excluding the ones it just applied from this client); the client upserts them locally without setting `dirty`, then stores the new cursor.
- **Deletes** are soft (`deleted_at`) and sync like any update; a cleanup job hard-deletes rows deleted > 90 days ago on both sides.
- Clock skew guard: the server rejects `updated_at` more than 24 h in the future.

### When it runs
- On app open (after the Health Connect import), after saving a session or completing/skipping a plan workout (debounced 10 s), on pull-to-refresh, and via **"Sync now"** in Settings.
- Background: `expo-background-task` roughly every few hours when on a network (best effort; Android decides timing).
- Offline: nothing queues except the `dirty` flags; the next successful sync catches up.

### Restore / new phone
- Fresh install → onboarding offers **"Restore from cloud"** → enter/scan the token → full pull (cursor 0) → app is back exactly as it was, plans and history included. Track blobs download lazily when a session's map is opened.

### Settings & visibility
- Settings → **Cloud sync**: on/off, server URL, token, last synced time, pending changes count, "Sync now", "Re-upload everything".
- A small sync-status dot in Settings only; no banners unless sync has failed for > 3 days.

---

## 18. Notifications

- Plan-day reminder at a chosen time ("Intervals today", body: "42 min").
- Evening nudge if a plan workout is still pending (optional).
- Foreground-service notification during sessions with live stats + pause action.
- Rest-timer completion (strength).

---

## 19. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M0** | **Plan + checklist core** | Monorepo scaffold (pnpm + Turborepo, `apps/mobile`, `packages/core`, `packages/schema`), Drizzle schema, workout model + DSL parser, HR profile & zones, first presets (5K and Zone 2 Base, simple scheduler OK), per-step targets in the workout model, Today checklist with Done / Done + details / Skip, Quick log, Plan calendar view with **drag-to-move, day picker, swap and undo**. *First version you actually use day to day: no GPS, no Health Connect needed.* |
| **M1** | **GPS recording + map/replay** | Phone records a 30-min outdoor run with screen off, no gaps (foreground service, battery-optimization exemption); workout screen that follows each step's target (pace, HR, effort), cues; summary with map + replay. *This is the default way to run, so it moves up.* |
| M1.5 | Strength + guided stretching | Exercise catalog import (our schema, overrides, images, starter stretch routines) seeded into SQLite. Workouts + the Plan tab's weekly schedule, Hevy-style logging with last-time values and rest timer. Stretch routines on the schedule with reminders and the **guided player**; post-run stretch reminder. |
| M2 | Heart rate: Bluetooth + Health Connect | Pair the Venu 3 broadcast, auto-connect on Start, live HR + HR ring, save HR with the session; new-activity modal; **merge watch HR into phone sessions**; import watch-only runs and link them to the plan; HR stats; resting HR + steps on Today. Routes for watch-only runs from Health Connect if Garmin writes them, otherwise GPX/FIT import. |
| M3 | Session player (full) | Treadmill + timer modes, sprint/interval cues, pace nudges, crash recovery, auto-pause |
| M4 | Workout builder + library | Build, save, start any walk/run/sprint/Z2 combo |
| M5 | Pace profile | Time-trial workout, VDOT calc, pace zones |
| M6 | Plan engine (full) | All presets, wizard, calendar view, adaptation rules |
| M9 | Stats + history | Charts, PBs, adherence, steps |
| M10 | Live HR extras | Off-zone voice cues, HR-driven run/walk auto-switching |
| M11 | Polish + Neon sync | Backup/export, notifications, settings, diagnostics, design pass. Neon sync (moved from M2.5): `fit` schema in Neon, shared Drizzle schema + parity test, `apps/api` sync endpoint on Vercel (`/api/sync`), push/pull with cursor, token auth, restore-from-cloud |

Every milestone after M0 is additive: the app is usable for planning and checking off from M0 on, and each later piece only adds data or convenience.

---

## 20. Open Questions

1. Primary distance unit — miles or km? (Affects spoken cues and preset wording.)
2. Watch is a **Venu 3**. It has Broadcast Heart Rate (Settings › Watch Sensors › Wrist Heart Rate); confirm Bluetooth support with a BLE scanner (nRF Connect, Heart Rate service `0x180D`).
3. Zone method — Karvonen (default) or MAF? Measured max HR available?
4. Map provider — leaning MapLibre + free vector tiles (per-segment route colors, no API key). Google Maps only if you prefer its look.
5. Does Garmin write GPS routes to Health Connect? If not, watch runs get maps only via GPX/FIT file import (or by recording on the phone).
6. Should strength days count toward "hard day" spacing by default?
7. Calorie estimate — worth showing at all for a personal app?
8. Detail images in Vercel Blob (spec default) or bundle everything in the app (bigger APK, fully offline)?
9. Post-run stretch reminder — after every run, or only runs over a set duration?
