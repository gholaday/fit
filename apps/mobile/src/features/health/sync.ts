/**
 * Health Connect sync (spec §11). Reads Health Connect and hands normalized records to the
 * repository, which owns merge, match and dedupe. Runs on app open, on pull-to-refresh
 * on Today and after a run is saved; overlapping calls share one run.
 *
 * 1. Changes since the stored token, or the last 30 days without one (or when it expired).
 * 2. Daily steps, resting HR and active calories for the days touched.
 * 3. Exercise sessions, with average and max HR, distance and calories from the same source.
 * 4. Health Connect HR for saved phone sessions that still need it.
 * 5. Weigh-ins, by time window rather than the changes token.
 * 6. Store the new token and the sync time.
 */
import { type DailyMetricsInput, type ExternalActivity, type ExternalSessionInput, GARMIN_CONNECT_PACKAGE, type IsoDate, addDays, localIsoDate } from '@fit/core';
import { Platform } from 'react-native';
import type * as HealthConnectLib from 'react-native-health-connect';
import type { Permission, RecordResult } from 'react-native-health-connect';
import { repo } from '@/data';
import { actions, showSnack, useFit } from '@/data/store';
import { openActivities, reloadHealth } from './state';

export const READ_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'Steps' },
  { accessType: 'read', recordType: 'RestingHeartRate' },
  { accessType: 'read', recordType: 'ActiveCaloriesBurned' },
  { accessType: 'read', recordType: 'Distance' },
  { accessType: 'read', recordType: 'Weight' },
];

const CHANGE_TYPES = ['ExerciseSession', 'Steps', 'RestingHeartRate', 'ActiveCaloriesBurned'] as const;
const DAYS_BACK = 30;
const DAY_MS = 86_400_000;

export type HealthAvailability = 'available' | 'update' | 'missing';

export interface HealthStatus {
  availability: HealthAvailability;
  /** Read permissions granted, of READ_PERMISSIONS. */
  granted: number;
}

type HealthConnect = typeof HealthConnectLib;
let lib: HealthConnect | undefined;

/**
 * The library binds its native module when imported, and Today imports this file. Loading
 * it on first use keeps Health Connect off the startup path (spec §2: after first paint).
 */
async function hc(): Promise<HealthConnect> {
  lib ??= await import('react-native-health-connect');
  return lib;
}

let ready = false;

async function init(): Promise<HealthAvailability> {
  if (Platform.OS !== 'android') return 'missing';
  const { SdkAvailabilityStatus, getSdkStatus, initialize } = await hc();
  const sdk = await getSdkStatus();
  if (sdk === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update';
  if (sdk !== SdkAvailabilityStatus.SDK_AVAILABLE) return 'missing';
  if (!ready) ready = await initialize();
  return ready ? 'available' : 'missing';
}

async function grantedTypes(): Promise<Set<string>> {
  const granted = await (await hc()).getGrantedPermissions();
  return new Set(granted.filter((g) => g.accessType === 'read').map((g) => g.recordType));
}

export async function healthStatus(): Promise<HealthStatus> {
  const availability = await init();
  if (availability !== 'available') return { availability, granted: 0 };
  const types = await grantedTypes();
  return { availability, granted: READ_PERMISSIONS.filter((p) => types.has(p.recordType)).length };
}

/** Shows the Health Connect permission sheet; returns how many reads were granted. */
export async function requestHealthPermissions(): Promise<number> {
  if ((await init()) !== 'available') return 0;
  const granted = await (await hc()).requestPermission(READ_PERMISSIONS);
  return READ_PERMISSIONS.filter((p) => granted.some((g) => g.recordType === p.recordType && g.accessType === 'read')).length;
}

// ---------- mapping ----------

const activityFor = ({ ExerciseType }: HealthConnect): Record<number, ExternalActivity> => ({
  [ExerciseType.RUNNING]: 'run',
  [ExerciseType.RUNNING_TREADMILL]: 'treadmill',
  [ExerciseType.WALKING]: 'walk',
  [ExerciseType.HIKING]: 'hike',
  [ExerciseType.BIKING]: 'bike',
  [ExerciseType.BIKING_STATIONARY]: 'bike',
  [ExerciseType.SWIMMING_POOL]: 'swim',
  [ExerciseType.SWIMMING_OPEN_WATER]: 'swim',
  [ExerciseType.STRENGTH_TRAINING]: 'strength',
  [ExerciseType.WEIGHTLIFTING]: 'strength',
  [ExerciseType.CALISTHENICS]: 'strength',
  [ExerciseType.HIGH_INTENSITY_INTERVAL_TRAINING]: 'strength',
  [ExerciseType.STRETCHING]: 'stretch',
  [ExerciseType.YOGA]: 'stretch',
  [ExerciseType.PILATES]: 'stretch',
});
let activities: Record<number, ExternalActivity> | undefined;

const between = (startTime: string, endTime: string) => ({ operator: 'between' as const, startTime, endTime });

/** All pages of a read. */
async function readAll<T extends 'ExerciseSession' | 'HeartRate' | 'RestingHeartRate' | 'Weight'>(type: T, startTime: string, endTime: string, origins?: string[]): Promise<RecordResult<T>[]> {
  const out: RecordResult<T>[] = [];
  const { readRecords } = await hc();
  let pageToken: string | undefined;
  do {
    const page = await readRecords(type, { timeRangeFilter: between(startTime, endTime), dataOriginFilter: origins, pageSize: 1000, pageToken });
    out.push(...page.records);
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return out;
}

async function toExternal(rec: RecordResult<'ExerciseSession'>): Promise<ExternalSessionInput | undefined> {
  const id = rec.metadata?.id;
  const origin = rec.metadata?.dataOrigin;
  if (!id || !origin) return undefined;
  const mod = await hc();
  const { aggregateRecord } = mod;
  activities ??= activityFor(mod);
  const window = between(rec.startTime, rec.endTime);
  const filter = [origin];
  // Each read fails on its own when that permission is missing; the field is then left out.
  const [hr, kcal, distance] = await Promise.all([
    aggregateRecord({ recordType: 'HeartRate', timeRangeFilter: window, dataOriginFilter: filter }).catch(() => undefined),
    aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter: window, dataOriginFilter: filter }).catch(() => undefined),
    aggregateRecord({ recordType: 'Distance', timeRangeFilter: window, dataOriginFilter: filter }).catch(() => undefined),
  ]);
  const input: ExternalSessionInput = {
    hcRecordId: id,
    originPackage: origin,
    activity: activities[rec.exerciseType] ?? 'other',
    startedAt: rec.startTime,
    endedAt: rec.endTime,
    hasRoute: rec.exerciseRoute !== undefined,
  };
  if (rec.title) input.title = rec.title;
  if (hr && hr.MEASUREMENTS_COUNT > 0) {
    input.avgHr = Math.round(hr.BPM_AVG);
    input.maxHr = Math.round(hr.BPM_MAX);
  }
  if (distance && distance.DISTANCE.inMeters > 0) input.distanceM = Math.round(distance.DISTANCE.inMeters);
  if (kcal && kcal.ACTIVE_CALORIES_TOTAL.inKilocalories > 0) input.activeKcal = Math.round(kcal.ACTIVE_CALORIES_TOTAL.inKilocalories);
  return input;
}

/** Local midnight of an ISO date, as an ISO instant. */
const dayStart = (date: IsoDate) => new Date(`${date}T00:00:00`).toISOString();

async function dailyMetrics(from: IsoDate, to: IsoDate, types: Set<string>): Promise<DailyMetricsInput[]> {
  const range = between(dayStart(from), dayStart(addDays(to, 1)));
  const slicer = { period: 'DAYS' as const, length: 1 };
  const { aggregateGroupByPeriod } = await hc();
  const [steps, kcal, resting] = await Promise.all([
    types.has('Steps') ? aggregateGroupByPeriod({ recordType: 'Steps', timeRangeFilter: range, timeRangeSlicer: slicer }) : [],
    types.has('ActiveCaloriesBurned') ? aggregateGroupByPeriod({ recordType: 'ActiveCaloriesBurned', timeRangeFilter: range, timeRangeSlicer: slicer }) : [],
    types.has('RestingHeartRate') ? readAll('RestingHeartRate', range.startTime, range.endTime) : [],
  ]);
  const rows = new Map<IsoDate, DailyMetricsInput>();
  const row = (date: IsoDate, origins: readonly string[] | undefined) => {
    let r = rows.get(date);
    if (!r) rows.set(date, (r = { date, source: origins?.[0] ?? 'health_connect' }));
    return r;
  };
  for (const g of steps) if (g.result.COUNT_TOTAL > 0) row(localIsoDate(new Date(g.startTime)), g.result.dataOrigins).steps = g.result.COUNT_TOTAL;
  for (const g of kcal) {
    const k = g.result.ACTIVE_CALORIES_TOTAL.inKilocalories;
    if (k > 0) row(localIsoDate(new Date(g.startTime)), g.result.dataOrigins).activeKcal = Math.round(k);
  }
  // The last reading of each day.
  for (const r of [...resting].sort((a, b) => a.time.localeCompare(b.time))) {
    const origin = r.metadata?.dataOrigin;
    row(localIsoDate(new Date(r.time)), origin ? [origin] : undefined).restingHr = Math.round(r.beatsPerMinute);
  }
  return [...rows.values()];
}

/**
 * Steps in each hour of a day, read straight from Health Connect (nothing is stored), for
 * the line on Today's steps card. Undefined without Health Connect or the steps permission.
 */
export async function hourlySteps(date: IsoDate): Promise<number[] | undefined> {
  if ((await init()) !== 'available' || !(await grantedTypes()).has('Steps')) return undefined;
  const { aggregateGroupByDuration } = await hc();
  const groups = await aggregateGroupByDuration({ recordType: 'Steps', timeRangeFilter: between(dayStart(date), dayStart(addDays(date, 1))), timeRangeSlicer: { duration: 'HOURS', length: 1 } });
  const out = Array.from({ length: 24 }, () => 0);
  for (const g of groups) out[new Date(g.startTime).getHours()]! += g.result.COUNT_TOTAL;
  return out;
}

// ---------- sync ----------

interface Changes {
  token: string;
  /** Undefined means read the whole window (no token, or it expired). */
  sessions?: RecordResult<'ExerciseSession'>[];
  days?: Set<IsoDate>;
}

async function readChanges(token: string | undefined, types: Set<string>): Promise<Changes> {
  const { getChanges } = await hc();
  const recordTypes = CHANGE_TYPES.filter((t) => types.has(t));
  if (!token) return { token: (await getChanges({ recordTypes: [...recordTypes] })).nextChangesToken };
  const sessions: RecordResult<'ExerciseSession'>[] = [];
  const days = new Set<IsoDate>();
  let next = token;
  for (;;) {
    const page = await getChanges({ changesToken: next, recordTypes: [...recordTypes] });
    if (page.changesTokenExpired) return { token: (await getChanges({ recordTypes: [...recordTypes] })).nextChangesToken };
    for (const { record } of page.upsertionChanges) {
      if (record.recordType === 'ExerciseSession') sessions.push(record);
      else if ('startTime' in record) days.add(localIsoDate(new Date(record.startTime)));
      else if ('time' in record) days.add(localIsoDate(new Date(record.time)));
    }
    next = page.nextChangesToken;
    if (!page.hasMore) break;
  }
  return { token: next, sessions, days };
}

export interface SyncResult {
  ok: boolean;
  /** Why it did not run: Health Connect missing, or no permission. */
  skipped?: 'unavailable' | 'no_permission';
}

let running: Promise<SyncResult> | undefined;

export function syncHealth(): Promise<SyncResult> {
  running ??= run().finally(() => {
    running = undefined;
  });
  return running;
}

async function run(): Promise<SyncResult> {
  try {
    if ((await init()) !== 'available') return { ok: false, skipped: 'unavailable' };
    const types = await grantedTypes();
    if (!READ_PERMISSIONS.some((p) => types.has(p.recordType))) return { ok: false, skipped: 'no_permission' };
    const prefs = useFit.getState().settings.healthConnect;
    const now = new Date();
    const today = localIsoDate(now);
    const since = new Date(now.getTime() - DAYS_BACK * DAY_MS).toISOString();

    // Take the token before reading so nothing written meanwhile is missed.
    const changes = await readChanges(repo.healthSyncState().changesToken, types);
    const full = changes.sessions === undefined;

    // Daily metrics: the whole window on a full read, else today, yesterday and touched days.
    const days = full ? undefined : new Set([today, addDays(today, -1), ...(changes.days ?? [])]);
    const from = days ? [...days].sort()[0]! : addDays(today, -DAYS_BACK);
    const metrics = await dailyMetrics(from, today, types);
    repo.upsertDailyMetrics(days ? metrics.filter((m) => days.has(m.date)) : metrics);

    // Watch sessions. Only finished ones; Garmin only unless every source is allowed.
    if (prefs.importWorkouts && types.has('ExerciseSession')) {
      const origins = prefs.allSources ? undefined : [GARMIN_CONNECT_PACKAGE];
      const records = full ? await readAll('ExerciseSession', since, now.toISOString(), origins) : changes.sessions!.filter((r) => !origins || origins.includes(r.metadata?.dataOrigin ?? ''));
      const inputs = (await Promise.all(records.filter((r) => Date.parse(r.endTime) <= now.getTime()).map(toExternal))).filter((x): x is ExternalSessionInput => x !== undefined);
      if (inputs.length > 0) {
        const result = repo.importExternalSessions(inputs);
        for (const m of result.merged) {
          showSnack({
            message: `Added Garmin heart rate to ${m.sessionName}`,
            actionLabel: 'Undo',
            onAction: () => {
              repo.undoMerge(m.externalId);
              reloadHealth();
              openActivities();
            },
          });
        }
        if (result.added.some((a) => a.status === 'new')) {
          reloadHealth();
          openActivities();
        }
      }
    }

    // HR for phone sessions recorded without a sensor, or with dropouts.
    if (prefs.addHr && types.has('HeartRate')) {
      for (const w of repo.sessionsNeedingHr(since)) {
        const records = await readAll('HeartRate', w.startedAt, w.endedAt);
        const samples = records.flatMap((r) => r.samples.map((x) => ({ time: x.time, bpm: x.beatsPerMinute })));
        repo.addHealthHr(w.sessionId, samples);
      }
    }

    // Weigh-ins from every app (a scale writes its own records). The 30 day window on a full
    // read, else from two days before the newest imported one; the repository dedupes by id.
    if (types.has('Weight')) {
      const newest = repo.weighIns(50).find((w) => w.source === 'health_connect')?.measuredAt;
      const from = full || !newest ? since : new Date(Date.parse(newest) - 2 * DAY_MS).toISOString();
      const records = await readAll('Weight', from, now.toISOString());
      const inputs = records.flatMap((r) => (r.metadata?.id ? [{ hcRecordId: r.metadata.id, measuredAt: r.time, kg: r.weight.inKilograms }] : []));
      if (inputs.length > 0) repo.importHealthWeights(inputs);
    }

    repo.setHealthSyncState({ changesToken: changes.token, lastSyncedAt: new Date().toISOString() });
    reloadHealth();
    actions.reload();
    return { ok: true };
  } catch (e) {
    console.warn('Health Connect sync failed', e);
    return { ok: false };
  }
}

/** Settings "Re-sync last 30 days": forget the token, then sync. */
export function resyncHealth(): Promise<SyncResult> {
  const { lastSyncedAt } = repo.healthSyncState();
  repo.setHealthSyncState({ lastSyncedAt: lastSyncedAt ?? new Date(0).toISOString() });
  return syncHealth();
}
