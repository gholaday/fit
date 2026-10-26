# Fit monorepo

Read `HANDOFF.md`, `docs/spec.md`, `docs/design.md` and `docs/decisions.md` before working.

## Layout and ownership
Two Claude sessions work in this folder at the same time. Stay inside the paths you own; if you need a change elsewhere, ask the owner.
- **Lead (full stack):** root config, `packages/*`, `apps/api`, `docs/`. Owns `pnpm-lock.yaml` and root `package.json`.
- **Mobile:** `apps/mobile/**` only.

`packages/core` is pure TypeScript (no React, no Expo, no I/O). `packages/schema` holds Drizzle tables and migrations. Mobile reads and writes through the repository layer in `apps/mobile/src/data`, built on `@fit/schema`, and calls `@fit/core` for all plan/schedule/moving logic.

## Rules
- Keep `pnpm typecheck`, `pnpm lint`, `pnpm test` green. Tests only in `packages/*` (Vitest, table-driven, fixed clock). No UI tests.
- Commit only your own paths: `git add <your paths>` then commit. Never `git add -A`. Never rewrite history.
- Add mobile dependencies with `npx expo install <pkg>` from `apps/mobile`; tell the lead when you do (lockfile is shared).
- Copy rules from `docs/design.md` apply to every UI string: no middle dots, no em/en dashes, no emoji, no exclamation marks, units always shown.
- Storage units are SI (meters, seconds, kg). Convert to miles/pounds only for display.
