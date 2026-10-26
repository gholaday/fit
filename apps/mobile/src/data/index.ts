import type { FitRepository, IdGen } from '@fit/core';
import { createSqliteRepository, migrations, tables } from '@fit/schema';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import { monotonicFactory } from 'ulid';

const sqlite = openDatabaseSync('fit.db');
// NORMAL skips the fsync on every commit in WAL mode (it syncs at checkpoints). A commit can
// only be lost to power loss or an OS crash, never to the app crashing, and run recovery
// already works from the last 5 s save.
sqlite.execSync('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
const db = drizzle(sqlite, { schema: tables });
migrateSync();

/**
 * Hermes has no crypto.getRandomValues, so ulid takes its randomness from SQLite's
 * randomblob (a CSPRNG seeded from the OS). One query fills a pool of 256 bytes;
 * an id uses 16. Declared before the repo, which creates ids while seeding.
 */
let pool: Uint8Array = new Uint8Array(0);
let poolAt = 0;
function randomByteFraction(): number {
  if (poolAt >= pool.length) {
    pool = sqlite.getFirstSync<{ b: Uint8Array }>('SELECT randomblob(256) AS b')!.b;
    poolAt = 0;
  }
  return pool[poolAt++]! / 256;
}

/** The one repository the app talks to. Ready on import, so the store reads on the first frame. */
const ulid = monotonicFactory(randomByteFraction);

/** Ids for things the UI creates before saving (builder steps). Same generator as the repository. */
export const newId: IdGen = () => ulid();

export const repo: FitRepository = createSqliteRepository(db, { clock: () => new Date(), newId });

/**
 * drizzle's expo-sqlite `migrate` is async only because it reads migration files. Ours are
 * bundled as strings, so this does the same parsing and calls the dialect's migrate, which
 * is synchronous on a sync session. No splash hold and no async gap before the first read.
 */
function migrateSync() {
  const queries = migrations.journal.entries.map((entry) => {
    const sql = migrations.migrations[`m${entry.idx.toString().padStart(4, '0')}` as keyof typeof migrations.migrations];
    if (!sql) throw new Error(`Missing migration: ${entry.tag}`);
    return { sql: sql.split('--> statement-breakpoint'), bps: entry.breakpoints, folderMillis: entry.when, hash: '' };
  });
  const internal = db as unknown as { dialect: { migrate(m: typeof queries, session: unknown): void }; session: unknown };
  internal.dialect.migrate(queries, internal.session);
}
