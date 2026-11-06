/**
 * The smaller pieces of the Orbit Today (spec §14): the stats row, the rest day cards, the
 * all done summary, Up next and the slim bar the header and ring collapse into.
 */
import { type AgendaItem, type IsoDate, addDays, formatDistance, formatMinutes, localIsoDate, weekdayOf } from '@fit/core';
import { router } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { repo } from '@/data';
import { actions, useDataVersion, useFit, useRoutines, useUnits } from '@/data/store';
import { itemSubtitle } from '@/features/items/meta';
import { recordLabel, recordValue } from '@/features/records/records';
import { rateLabel, weightLabel } from '@/features/weight/format';
import { haptic } from '@/lib/haptics';
import { monthDay, thousands, weekdayLong, weekdayShort } from '@/lib/format';
import { createStyles, laneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { GradientTile, LaneTile, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { tomorrowLine } from './lanes';
import { MiniOrbit, type OrbitArc } from './OrbitRing';

/** What was done on a day, for the stats row and the all done summary. */
export interface DayTotals {
  activeS: number;
  runM: number;
  sets: number;
}

/**
 * Totals from the day's sessions, watch activities, quick logs and items completed by hand.
 * Takes the data version so the memo re-reads after a write.
 */
export function dayTotals(day: IsoDate, items: readonly AgendaItem[], _version: number): DayTotals {
  const before = new Date(`${addDays(day, 1)}T00:00:00`).toISOString();
  const sessions = repo.history({ source: 'fit', before, limit: 30 }).filter((r) => localIsoDate(new Date(r.startedAt)) === day);
  const watch = repo.externalSessions(day, day).filter((x) => !x.linkedPlanKey);
  const logs = repo.quickLogs(day, day);
  // Items done by hand carry their own minutes; a session or watch activity already counts above.
  const manual = items.filter((i) => i.status === 'done' && !i.sessionId && !i.externalSessionId);
  const activeS =
    sessions.reduce((t, r) => t + r.durationS, 0) +
    watch.reduce((t, x) => t + (Date.parse(x.endedAt) - Date.parse(x.startedAt)) / 1000, 0) +
    logs.reduce((t, l) => t + l.minutes * 60, 0) +
    manual.reduce((t, i) => t + (i.details?.minutes ? i.details.minutes * 60 : i.estSeconds), 0);
  const runM =
    sessions.filter((r) => r.kind === 'run').reduce((t, r) => t + (r.distanceM ?? 0), 0) +
    watch.filter((x) => x.activity === 'run' || x.activity === 'treadmill').reduce((t, x) => t + (x.distanceM ?? 0), 0) +
    logs.filter((l) => l.activityType === 'run').reduce((t, l) => t + (l.distanceM ?? 0), 0) +
    manual.filter((i) => i.lane === 'run').reduce((t, i) => t + (i.details?.distanceM ?? 0), 0);
  const sets = sessions.filter((r) => r.kind === 'strength').reduce((t, r) => t + (repo.strengthSession(r.id)?.sets.length ?? 0), 0);
  return { activeS, runM, sets };
}

/** Steps, active time and the weight trend (once there are weigh-ins) under the lane cards. */
export function StatsRow({ steps, activeS }: { steps?: number; activeS: number }) {
  const s = useStyles();
  const unit = useUnits().weight;
  const version = useDataVersion();
  const weight = useMemo(() => readWeight(version), [version]);
  return (
    <View style={s.stats}>
      <Stat value={steps === undefined ? 'Not synced' : thousands(steps)} label="steps" />
      <Stat value={formatMinutes(activeS)} label="active" />
      {weight && <Stat value={weightLabel(weight.trendKg, unit)} label="trend" onPress={() => router.push('/weight')} />}
    </View>
  );
}

function readWeight(_version: number) {
  return repo.weightSummary();
}

function Stat({ value, label, onPress }: { value: string; label: string; onPress?: () => void }) {
  const body = (
    <>
      <T v="stat" num numberOfLines={1}>
        {value}
      </T>
      <T v="caption" tone="secondary">
        {label}
      </T>
    </>
  );
  if (!onPress) return <View style={{ alignItems: 'center', flex: 1 }}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [{ alignItems: 'center', flex: 1 }, pressed && { opacity: 0.6 }]}>
      {body}
    </Pressable>
  );
}

/** Rest day: what is tomorrow, a stretch to pick, and the weight trend with its rate. */
export function RestCards({ tomorrow }: { tomorrow: readonly AgendaItem[] }) {
  const s = useStyles();
  const p = usePalette();
  const routines = useRoutines();
  const units = useUnits();
  const version = useDataVersion();
  const weight = useMemo(() => readWeight(version), [version]);
  const [stretch, setStretch] = useState(false);
  const first = tomorrow.find((i) => i.lane !== 'stretch');
  return (
    <>
      <View style={s.rowCard}>
        <View style={[s.iconTile, { backgroundColor: first ? laneColor(p, first.lane).tint : p.inset }]}>
          <Icons.calendar size={18} color={first ? laneColor(p, first.lane).onTint : p.textSecondary} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">{tomorrowLine(tomorrow)}</T>
          {first && (
            <T v="label" tone="secondary" num>
              {itemSubtitle(first, routines, units)}
            </T>
          )}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => setStretch(true)} style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}>
          <GradientTile lane="stretch" size={32} />
          <T v="bodyStrong">Stretch</T>
          <T v="caption" tone="secondary">
            Pick a routine
          </T>
        </Pressable>
        {weight && (
          <Pressable accessibilityRole="button" accessibilityHint="Opens your weight" onPress={() => router.push('/weight')} style={({ pressed }) => [s.tile, pressed && { opacity: 0.7 }]}>
            <View style={[s.iconTile, { width: 32, height: 32, backgroundColor: p.inset }]}>
              <Icons.trendDown size={16} color={p.weight} />
            </View>
            <T v="bodyStrong" num>
              {weightLabel(weight.trendKg, units.weight)}
            </T>
            <T v="caption" tone="secondary" num>
              {weight.rateKgWeek !== undefined ? rateLabel(weight.rateKgWeek, units.weight) : 'Trend'}
            </T>
          </Pressable>
        )}
      </View>
      <StretchSheet visible={stretch} onClose={() => setStretch(false)} />
    </>
  );
}

/** Stretch routines to start on a day with nothing planned. */
function StretchSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const routines = useRoutines().filter((r) => r.kind === 'stretch');
  return (
    <Sheet visible={visible} onClose={onClose} title="Pick a stretch" scroll>
      {routines.length === 0 ? (
        <T v="body" tone="secondary">
          No stretch routines yet. Add one in the Library.
        </T>
      ) : (
        <View style={s.list}>
          {routines.map((r, i) => (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                haptic.commit();
                router.push({ pathname: '/stretch/[id]', params: { id: r.id } });
              }}
              style={({ pressed }) => [s.listRow, i > 0 && s.divider, pressed && { opacity: 0.6 }]}
            >
              <LaneTile lane="stretch" />
              <View style={{ flex: 1 }}>
                <T v="bodyMedium">{r.name}</T>
                <T v="caption" tone="secondary" num>{`${r.itemCount} moves, about ${formatMinutes(r.estSeconds)}`}</T>
              </View>
              <Icons.chevronRight size={14} color={p.textTertiary} />
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
  );
}

/** Today's newest record, if one was set today. */
function readRecord(day: IsoDate, _version: number) {
  return repo.recentRecords(20).find((e) => e.date === day && e.celebrate);
}

/** All done: active time, distance run and sets lifted, a record set today, and tomorrow. */
export function DoneCards({ day, totals, tomorrow }: { day: IsoDate; totals: DayTotals; tomorrow: readonly AgendaItem[] }) {
  const s = useStyles();
  const p = usePalette();
  const units = useUnits();
  const version = useDataVersion();
  const record = useMemo(() => readRecord(day, version), [day, version]);
  const first = tomorrow.find((i) => i.lane !== 'stretch');
  return (
    <>
      <View style={s.summary}>
        <Total value={formatMinutes(totals.activeS)} label="active" />
        {totals.runM > 0 && <Total value={formatDistance(totals.runM, units.distance, 1)} label="run" color={p.run.onTint} />}
        {totals.sets > 0 && <Total value={`${totals.sets} sets`} label="lifted" color={p.strength.onTint} />}
      </View>
      {record && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(record.group === 'lift' ? { pathname: '/lift/[id]', params: { id: record.sessionId } } : { pathname: '/summary/[id]', params: { id: record.sessionId } })}
          style={({ pressed }) => [s.rowCard, pressed && { opacity: 0.7 }]}
        >
          <View style={[s.iconTile, { backgroundColor: p.hard.tint }]}>
            <Icons.trophy size={18} color={p.hard.onTint} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="bodyStrong">New record</T>
            <T v="label" tone="secondary" num>{`${recordLabel(record, true)}, ${recordValue(record, units)}`}</T>
          </View>
        </Pressable>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: first ? laneColor(p, first.lane).color : p.textMuted }} />
        <T v="body" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {tomorrowLine(tomorrow)}
        </T>
      </View>
    </>
  );
}

function Total({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <T v="stat" num numberOfLines={1} adjustsFontSizeToFit color={color}>
        {value}
      </T>
      <T v="caption" tone="secondary">
        {label}
      </T>
    </View>
  );
}

const UP_NEXT_ROWS = 4;

/** The rest of the week after `day`, item by item. */
export function UpNext({ day }: { day: IsoDate }) {
  const s = useStyles();
  const p = usePalette();
  const end = addDays(day, 6);
  useEffect(() => actions.ensureRange(addDays(day, 1), end), [day, end]);
  const items = useFit(
    useShallow((st) =>
      Array.from({ length: 6 }, (_, i) => addDays(day, i + 1))
        .flatMap((d) => (st.byDate[d] ?? []).map((k) => st.items[k]!))
        .filter((i) => i.status === 'pending' && i.lane !== 'stretch')
        .slice(0, UP_NEXT_ROWS),
    ),
  );
  if (items.length === 0) return null;
  return (
    <View style={s.upNext}>
      <T v="label" tone="secondary">
        Up next
      </T>
      {items.map((i) => (
        <View key={i.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <T v="body" tone="secondary" style={{ width: 36 }}>
            {weekdayShort(weekdayOf(i.date))}
          </T>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: laneColor(p, i.lane).color }} />
          <T v="body" numberOfLines={1} style={{ flex: 1 }}>
            {i.title}
          </T>
          <T v="body" tone="secondary" num>
            {formatMinutes(i.estSeconds)}
          </T>
        </View>
      ))}
    </View>
  );
}

/** What the header and ring shrink to on scroll: a small ring, the count, the date and steps. */
export const SlimBar = memo(function SlimBar({ arcs, day, done, total, steps }: { arcs: readonly OrbitArc[]; day: IsoDate; done: number; total: number; steps?: number }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <View style={s.slim}>
      <MiniOrbit arcs={arcs} size={40} width={7} track={p.ringTrack} />
      <View style={{ flex: 1 }}>
        <T v="headline" num>
          {total === 0 ? 'Rest day' : `${done} of ${total} done`}
        </T>
        <T v="caption" tone="secondary">{`${weekdayLong(weekdayOf(day))}, ${monthDay(day)}`}</T>
      </View>
      <T v="label" tone="secondary" num>
        {steps === undefined ? 'Steps not synced' : `${thousands(steps)} steps`}
      </T>
    </View>
  );
});

const useStyles = createStyles((p) => ({
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 4 },
  rowCard: { backgroundColor: p.surface, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconTile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tile: { flex: 1, backgroundColor: p.surface, borderRadius: 18, padding: 14, gap: 6, alignItems: 'flex-start' },
  summary: { backgroundColor: p.surface, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 8 },
  upNext: { backgroundColor: p.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  slim: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  list: { backgroundColor: p.bg, borderRadius: 16, paddingHorizontal: 14 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
