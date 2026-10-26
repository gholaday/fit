# Decisions

Running log of decisions that change or clarify the spec.

| Date | Decision | Why |
|---|---|---|
| 2026-10-26 | Expo SDK 58 (RN 0.88, React 19.3, Reanimated 4.7, New Architecture only). | Current stable SDK. |
| 2026-10-26 | Styling uses React Native `StyleSheet` with a typed token module, not NativeWind. | NativeWind 4 (stable) targets Tailwind 3 and has friction with Reanimated 4; NativeWind 5 is still RC. StyleSheet has zero runtime cost. |
| 2026-10-26 | TypeScript pinned to 6.0.x. | typescript-eslint does not support TS 7 yet. |
| 2026-10-26 | pnpm `node-linker=hoisted`. | Metro and Expo autolinking are most reliable with a hoisted layout. |
| 2026-10-26 | API stays a stub in M0; real sync lands in M2.5. | Per handoff. |
| 2026-10-26 | Strength workouts are not hard days for back-to-back warnings. | Answers spec open question 6. |
| 2026-10-26 | Units default to miles and pounds, setting to switch. HR zones default to Karvonen. Maps will use MapLibre. | Handoff defaults. Internally everything is stored in meters, seconds and kg. |
| 2026-10-26 | `weekly_schedule` gains `starts_on` / `ends_on`. "Change the schedule" and weekday edits end the old entry and start a new one. | Past weeks and their completions keep their original days. |
| 2026-10-26 | DSL: bare `m` below 100 means minutes ("10m easy"), 100 and up means meters ("800m"). `min`, `km`, `mi` are explicit. | Matches how the spec's templates are written while staying unambiguous in practice. |
| 2026-10-26 | Plan workouts store pace zones, not resolved paces. A 5K goal time creates a `pace_profiles` row (`source = goal`). | A later VDOT bump updates every future workout without regenerating the plan. |
| 2026-10-26 | Migrations are inlined into `packages/schema/src/migrations.ts` by `pnpm --filter @fit/schema db:generate`. | Metro needs no `.sql` loader. |
| 2026-10-26 | Voice cues duck music through a small local Expo module (`apps/mobile/modules/audio-focus`) that requests `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` around each cue. | expo-speech never requests audio focus, and expo-audio only ducks while its own player plays. The spec requires ducking. |
| 2026-10-26 | The run notification uses expo-location's SDK 58 `BackgroundSession` API, with title "Run in progress" and text "2.41 mi, 21:14", updated on each location batch. | The legacy `startLocationUpdatesAsync` can't update notification text without restarting updates (risking gaps). An Android notification has only one text line. |
| 2026-10-26 | Maps use `@maplibre/maplibre-react-native` 11.5 with OpenFreeMap tiles (no key). It's unverified on RN 0.88 until the first native build. | Spec preference; resolves open question 4. |
| 2026-10-26 | Background location uses the SDK 58 `AUTOMOTIVE_NAVIGATION` profile. | It's the only profile with 1 s fixes and no batching or distance filter, which spec §5 needs. `FITNESS` is a 10 s interval with 2-minute batches. |
| 2026-10-26 | Countdown beeps are spoken ("Three", "Two", "One") through the same audio-focus path instead of using expo-audio. | expo-audio's plugin adds RECORD_AUDIO and a playback service by default. Spoken counts duck music with no extra package or permission. |
| 2026-10-26 | Player state records pause ranges; Settings gains `voice`, `cues`, `autoPause`, `autoPauseOnWalks`. | Splits exclude paused time and replay marks gaps; cue preferences persist (spec §5, §16). |
| 2026-10-26 | The exercise catalog ships as bundled `catalog.json`, upserted in one transaction (about 200 ms) after first paint, only when `CATALOG_VERSION` changes. Not a prebuilt SQLite file. | Spec §2 says prebuilt SQLite and §9 says JSON. JSON keeps one database file, lets seeding preserve hidden flags and custom rows, and never touches startup. |
| 2026-10-26 | Thumbnails (192 px WebP) ship for every exercise and detail frames (720 px) for stretches only, about 7 MB total. No Vercel Blob for now. | The guided player works fully offline; strength detail images can move to Blob later. Answers open question 8 for v1. |
| 2026-10-26 | Starter routines are read-only and re-seeded in place by slug; editing means "Duplicate". M0 starter rows are upgraded by name, keeping schedule links. | Re-seeding can never clobber your edits. |
| 2026-10-26 | Exercise names are sentence case with " - " turned into ", ", via overrides plus automatic cleanup. | Copy rules (no dashes as separators, sentence case). |
