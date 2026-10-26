We're building **Fit**, my personal fitness app: an Android-first Expo app plus a small Next.js sync API, in one monorepo. Everything you need is in this repo:

- `docs/spec.md` is the full product and technical spec. Read all of it before writing code.
- `docs/design.md` has the design tokens, icon set, copy rules, and an index of the mockups.
- `docs/mockups/light` and `docs/mockups/dark` are the screen designs (light is the primary reference). They're static design sources, not runnable pages; read the inline styles and the data in each file's script block.

## What the app is
One place to plan and track runs, strength workouts and stretching, with Runna-style running plans. Three kinds of activity with different levels of structure:
- **Running:** real plans (5K, 10K, half, base, speed, Zone 2) with progression and adaptation. Every run step has its own target: pace, heart rate, effort, or none.
- **Workouts:** sets of exercises assigned to weekdays.
- **Stretching:** routines on days and times, done with a guided player or just checked off.

Plan first, data second: anything can be completed with one tap. GPS, heart rate (Garmin Venu 3 via Bluetooth broadcast and Health Connect) and stats add detail but are never required.

## Your task: milestone M0 only
Build M0 as defined in the Milestones section of the spec, then stop for review. Roughly:
1. Monorepo scaffold: pnpm workspaces + Turborepo, `apps/mobile` (Expo, dev build, expo-router), `packages/core`, `packages/schema`. `apps/api` and `packages/sync` can be stubs for now.
2. Local SQLite + Drizzle schema for what M0 needs, with migrations. Include `updated_at`, `deleted_at` and ULID ids from the start so sync can be added later.
3. `packages/core`: the workout model with per-step targets, the DSL parser, HR zone math, plan generation for the **5K** and **Zone 2 Base** presets (simple scheduler is fine), the weekly schedule expansion with "just this time" overrides, completion levels, and the moving rules.
4. Mobile screens in Midnight light and dark:
   - Today: day widget with steps as a placeholder until Health Connect, plus the checklist with Done, Done + details and Skip.
   - Quick log.
   - Plan: This week (three lanes, drag to move, day picker, swap, undo) and Schedule.
   - Setup flow for HR zones and choosing a running plan.

Out of scope for M0: GPS recording, Bluetooth HR, Health Connect, Neon sync, the strength logger, the stretch player.

## Rules that matter
- **Performance first.** Follow the Performance section of the spec:
  - Budgets: cold start under 1.5 s, local taps under 100 ms, 60 fps.
  - Screens render from SQLite with optimistic writes.
  - FlashList, Reanimated on the UI thread, narrow Zustand selectors.
  - Hermes and the New Architecture on.
  - Don't add heavy dependencies.
- **Testing is tight and focused.** Vitest in `packages/core` only, covering plan generation, schedule expansion, moving rules, zone math and the DSL. Use small table-driven tests with a fixed clock. No UI or snapshot tests.
- **Design:** Tabler icons and the tokens in `docs/design.md`. Follow the copy rules exactly: no middle dots, no em or en dashes, no emoji or exclamation marks, units always shown.
- **Defaults for open questions:** miles and pounds (with a setting to switch), Karvonen heart-rate zones, MapLibre for maps later.
- **Library versions:** check current versions of Expo SDK and any libraries rather than assuming. If something in the spec conflicts with what the current libraries support, tell me instead of working around it silently.

## How to work
1. Read the spec, design doc and mockups. Then reply with a short M0 plan: package layout, schema tables, screen list, and the order you'll build in. Include any questions that would change the build. Wait for my go-ahead.
2. Build in small commits. Keep `pnpm typecheck`, `pnpm lint` and `pnpm test` green.
3. When M0 is done, give me a short summary: what works, what's stubbed, how to run a dev build on my Android phone, and any spec changes you'd suggest.
