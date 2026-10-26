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
