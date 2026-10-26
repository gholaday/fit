import { z } from 'zod';

/**
 * Sync protocol (spec §17): one endpoint, push then pull, last-write-wins by
 * updated_at, server_seq as the pull cursor. Types only in M0; the server and
 * client implementations land in M2.5.
 */

/** Tables that sync. Device-specific settings and seed data stay local. */
export const SYNCED_TABLES = [
  'settings',
  'hr_profiles',
  'pace_profiles',
  'workouts',
  'plans',
  'plan_workouts',
  'plan_events',
  'routines',
  'weekly_schedule',
  'schedule_overrides',
  'routine_completions',
  'quick_logs',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/** A row as sent over the wire: snake_case columns, at least id (or key) and updated_at. */
export const syncRowSchema = z
  .object({
    updated_at: z.number().int().nonnegative(),
    deleted_at: z.number().int().nonnegative().nullable().optional(),
  })
  .catchall(z.unknown());

export type SyncRow = z.infer<typeof syncRowSchema>;

const changesSchema = z.partialRecord(z.enum(SYNCED_TABLES), z.array(syncRowSchema));

/** Batch limits (spec §17). */
export const MAX_ROWS_PER_REQUEST = 500;
export const MAX_BYTES_PER_REQUEST = 1_000_000;
/** Server rejects updated_at further in the future than this. */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

export const syncRequestSchema = z.object({
  cursor: z.number().int().nonnegative(),
  changes: changesSchema,
});

export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncConflictSchema = z.object({
  table: z.enum(SYNCED_TABLES),
  id: z.string(),
  reason: z.enum(['older', 'clock_skew']),
});

export const syncResponseSchema = z.object({
  applied: z.number().int().nonnegative(),
  conflicts: z.array(syncConflictSchema),
  cursor: z.number().int().nonnegative(),
  changes: changesSchema,
});

export type SyncResponse = z.infer<typeof syncResponseSchema>;
export type SyncConflict = z.infer<typeof syncConflictSchema>;
