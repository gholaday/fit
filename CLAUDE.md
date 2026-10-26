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
- Add mobile dependencies with `npx expo install <pkg>` from `apps/mobile`, agreed with the lead first. Commit `pnpm-lock.yaml` in the same commit as the `package.json` change (CI uses `--frozen-lockfile`) and tell the lead.
- Copy rules from `docs/design.md` apply to every UI string: no middle dots, no em/en dashes, no emoji, no exclamation marks, units always shown.
- Storage units are SI (meters, seconds, kg). Convert to miles/pounds only for display.

## CI and releases
- Repo: https://github.com/gholaday/fit. The lead session pushes; the mobile session commits locally only.
- `.github/workflows/ci.yml` runs typecheck, lint, test and build on every push to main and on PRs.
- Releases follow the murmur pattern: commit "Release x.y.z" with a plain description of the changes as the body (it becomes the release notes), tag `vx.y.z`, push the tag. `release.yml` sets the app version and versionCode from the tag, runs `expo prebuild`, builds a release APK signed by `apps/mobile/plugins/with-release-signing.js` from the `ANDROID_*` secrets, and attaches `fit-x.y.z.apk` to the GitHub release.
