/**
 * Stats Records card: standing run records, a searchable list of lifts with their records
 * (each opens its history), and the latest records set. Replaces Personal bests.
 */
import { type LiftRecordKind, type RecordEvent, type RunRecordKind, PB_DISTANCES } from '@fit/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { repo } from '@/data';
import { useUnits } from '@/data/store';
import { monthDay } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { Segmented, T } from '@/ui/primitives';
import { Card } from '@/features/stats/charts';
import { recordLabel, recordValue, Trophy } from './records';

type Tab = 'run' | 'lift';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'run', label: 'Running' },
  { value: 'lift', label: 'Lifting' },
];

const RUN_ORDER: RunRecordKind[] = ['effort', 'longest_distance', 'longest_time', 'longest_nonstop', 'biggest_week'];
const LIFT_ORDER: LiftRecordKind[] = ['heaviest', 'one_rep_max', 'set_volume', 'most_reps', 'longest_hold', 'session_volume'];
/** The one number a lift is listed by: weight if it has one, else reps, else a hold. */
const HEADLINE: LiftRecordKind[] = ['heaviest', 'most_reps', 'longest_hold'];

const distanceRank = (m?: number) => PB_DISTANCES.findIndex((d) => Math.abs(d.meters - (m ?? 0)) < 1);
const runRank = (e: RecordEvent) => RUN_ORDER.indexOf(e.kind as RunRecordKind) * 100 + Math.max(0, distanceRank(e.meters));

/** Where a record's session opens: a Fit run's summary or a watch activity. Lifts have no detail yet. */
function openSession(e: RecordEvent): (() => void) | undefined {
  if (e.group !== 'run') return undefined;
  if (repo.session(e.sessionId)) return () => router.push({ pathname: '/summary/[id]', params: { id: e.sessionId } });
  if (repo.externalSession(e.sessionId)) return () => router.push({ pathname: '/activity/[id]', params: { id: e.sessionId } });
  return undefined;
}

export function RecordsCard({ records, recent, streak }: { records: RecordEvent[]; recent: RecordEvent[]; streak: number }) {
  const s = useStyles();
  const p = usePalette();
  const units = useUnits();
  const [tab, setTab] = useState<Tab>('run');
  const [query, setQuery] = useState('');
  const [exercise, setExercise] = useState<string>();

  const runs = records.filter((e) => e.group === 'run' && RUN_ORDER.includes(e.kind as RunRecordKind)).sort((a, b) => runRank(a) - runRank(b));
  const lifts = new Map<string, RecordEvent[]>();
  for (const e of records) if (e.group === 'lift' && e.exerciseId) lifts.set(e.exerciseId, [...(lifts.get(e.exerciseId) ?? []), e]);
  const q = query.trim().toLowerCase();
  const liftRows = [...lifts]
    .map(([id, es]) => ({ id, name: repo.exercise(id)?.name ?? 'Exercise', top: HEADLINE.flatMap((k) => es.find((e) => e.kind === k) ?? [])[0] }))
    .filter((r) => !q || r.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || r.name.toLowerCase().startsWith(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (runs.length === 0 && lifts.size === 0) return null;
  return (
    <Card title="Records" right={streak > 0 ? `${streak} week streak` : undefined}>
      <Segmented options={TABS} value={tab} onChange={setTab} look="inset" />
      {tab === 'run' ? (
        runs.length === 0 ? (
          <T v="caption" tone="secondary">
            No run records yet.
          </T>
        ) : (
          <View>
            {runs.map((e, i) => (
              <Line key={e.key} label={recordLabel(e)} value={recordValue(e, units)} date={e.date} first={i === 0} onPress={openSession(e)} />
            ))}
          </View>
        )
      ) : lifts.size === 0 ? (
        <T v="caption" tone="secondary">
          No lifting records yet.
        </T>
      ) : (
        <View>
          {lifts.size > 6 && (
            <View style={s.search}>
              <TextInput value={query} onChangeText={setQuery} placeholder="Search lifts" placeholderTextColor={p.textTertiary} accessibilityLabel="Search lifts" style={s.searchInput} />
            </View>
          )}
          {liftRows.map((r, i) => (
            <Line key={r.id} label={r.name} value={r.top ? recordValue(r.top, units) : ''} first={i === 0} onPress={() => setExercise(r.id)} />
          ))}
          {liftRows.length === 0 && (
            <T v="caption" tone="secondary" style={{ paddingVertical: 10 }}>
              No lifts match.
            </T>
          )}
        </View>
      )}

      {recent.length > 0 && (
        <View style={s.section}>
          <T v="bodyMedium">Recent</T>
          {recent.map((e, i) => (
            <View key={`${e.key}${e.sessionId}`} style={[s.row, i > 0 && s.divider]}>
              <Trophy />
              <T v="label" style={{ flex: 1 }} numberOfLines={2}>
                {recordLabel(e, true)}
              </T>
              <View style={{ alignItems: 'flex-end' }}>
                <T v="labelStrong" num>
                  {recordValue(e, units)}
                </T>
                <T v="caption" tone="secondary" num>
                  {monthDay(e.date)}
                </T>
              </View>
            </View>
          ))}
        </View>
      )}

      <ExerciseRecordsSheet exerciseId={exercise} onClose={() => setExercise(undefined)} />
    </Card>
  );
}

function Line({ label, value, date, first, onPress }: { label: string; value: string; date?: string; first: boolean; onPress?: (() => void) | undefined }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={({ pressed }) => [s.row, !first && s.divider, pressed && { opacity: 0.6 }]}>
      <T v="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </T>
      <View style={{ alignItems: 'flex-end' }}>
        <T v="bodyStrong" num>
          {value}
        </T>
        {date && (
          <T v="caption" tone="secondary" num>
            {monthDay(date)}
          </T>
        )}
      </View>
      {onPress ? <Icons.chevronRight size={14} color={p.textTertiary} /> : <View style={{ width: 14 }} />}
    </Pressable>
  );
}

/** One lift's standing records, then each time a record moved, newest first. */
function ExerciseRecordsSheet({ exerciseId, onClose }: { exerciseId: string | undefined; onClose: () => void }) {
  const s = useStyles();
  const units = useUnits();
  const events = exerciseId ? repo.exerciseRecords(exerciseId) : [];
  const standing = LIFT_ORDER.flatMap((k) => events.filter((e) => e.kind === k).at(-1) ?? []);
  const moves = events.filter((e) => e.celebrate).reverse();
  return (
    <Sheet visible={exerciseId !== undefined} onClose={onClose} title={exerciseId ? (repo.exercise(exerciseId)?.name ?? 'Exercise') : ''} scroll>
      <View style={{ gap: 14 }}>
        <View>
          {standing.map((e, i) => (
            <Line key={e.key} label={recordLabel(e)} value={recordValue(e, units)} date={e.date} first={i === 0} />
          ))}
        </View>
        {moves.length > 0 && (
          <View style={s.section}>
            <T v="bodyMedium">History</T>
            {moves.map((e, i) => (
              <View key={`${e.key}${e.sessionId}`} style={[s.row, i > 0 && s.divider]}>
                <T v="label" tone="secondary" num style={{ width: 64 }}>
                  {monthDay(e.date)}
                </T>
                <T v="label" style={{ flex: 1 }} numberOfLines={1}>
                  {recordLabel(e)}
                </T>
                <T v="labelStrong" num>
                  {recordValue(e, units)}
                </T>
              </View>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((p) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  section: { borderTopWidth: 1, borderTopColor: p.divider, paddingTop: 10 },
  search: { height: 40, borderRadius: 12, backgroundColor: p.inset, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, marginTop: 4, marginBottom: 4 },
  searchInput: { flex: 1, color: p.text, fontFamily: 'Inter', fontSize: 15, paddingVertical: 0 },
}));
