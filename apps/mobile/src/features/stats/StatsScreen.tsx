/**
 * Stats tab (spec §12, §14): plan completion for the period, running distance and time
 * with the run, walk and sprint split, heart rate progress, personal bests, streaks,
 * strength and stretching, then Activity (steps against the goal, resting heart rate).
 * A section with no data is hidden, not explained.
 */
import { type IsoDate, type Weekday, addDays, formatDistance, formatMinutes, formatPace, paceToUnit } from '@fit/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { useSettings, useToday } from '@/data/store';
import { RecordsCard } from '@/features/records/RecordsCard';
import { readAt, useFocusedDataVersion } from '@/lib/focusedVersion';
import { dateRangeLabel, dayOfMonth, monthDay, thousands, weekdayLetter } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, Segmented, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { type Bar, Card, Legend, ProgressRow, StackBars, Stat, TrendLine } from './charts';
import { type Period, type StatsData, loadStats } from './data';

const PERIODS: readonly { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3m', label: '3 months' },
];

export function StatsScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const today = useToday();
  // The tab stays mounted, and a full load is about 100 ms with a year of runs: writes made
  // on other tabs are picked up when Stats is shown again, not on every write.
  const version = useFocusedDataVersion();
  const [period, setPeriod] = useState<Period>('week');
  const [offset, setOffset] = useState(0);
  const data = useMemo(() => readAt(version, () => loadStats(period, offset, today)), [period, offset, today, version]);
  // Records span all time, so the period does not change them.
  const records = useMemo(() => readAt(version, () => ({ all: repo.records(), recent: repo.recentRecords(10) })), [version]);

  const go = (n: number) => {
    haptic.tick();
    setOffset(offset + n);
  };

  return (
    <>
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <T v="display" style={{ flex: 1 }} accessibilityRole="header">
            Stats
          </T>
          <Button label="History" kind="outline" size="sm" style={{ borderRadius: 18 }} onPress={() => router.push('/history')} />
        </View>
        <Segmented
          options={PERIODS}
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setOffset(0);
          }}
        />
        <View style={s.nav}>
          <IconButton label="Earlier" onPress={() => go(-1)}>
            <Icons.chevronLeft size={18} color={p.text} />
          </IconButton>
          <T v="bodyStrong" num>
            {dateRangeLabel(data.range.start, data.range.end)}
          </T>
          <IconButton label="Later" onPress={() => offset < 0 && go(1)} style={{ opacity: offset < 0 ? 1 : 0.3 }}>
            <Icons.chevronRight size={18} color={p.text} />
          </IconButton>
        </View>

        <CompletionCard data={data} period={period} />
        <StepsCard data={data} />
        <RunningCard data={data} />
        <HeartCard data={data} />
        <RecordsCard records={records.all} recent={records.recent} streak={data.streak} />
        <PlanWeeksCard data={data} />
        <StrengthCard data={data} />
        <StretchCard data={data} />

        {data.restingHr.length > 0 && (
          <T v="title" style={{ marginTop: 10 }} accessibilityRole="header">
            Activity
          </T>
        )}
        <RestingHrCard data={data} />
      </ScrollView>
      <StatusShade />
    </>
  );
}

const NOTHING_DUE: Record<Period, string> = {
  week: 'No planned workouts this week.',
  month: 'No planned workouts this month.',
  '3m': 'No planned workouts in these 3 months.',
};

function CompletionCard({ data, period }: { data: StatsData; period: Period }) {
  if (data.completion.length === 0) {
    return (
      <Card title="Completion">
        <T v="caption" tone="secondary">
          {NOTHING_DUE[period]}
        </T>
      </Card>
    );
  }
  return (
    <Card title="Completion">
      {data.completion.map((c) => (
        <ProgressRow key={`${c.lane}${c.name}`} lane={c.lane} name={c.name} value={`${c.done} of ${c.total}`} frac={c.total > 0 ? c.done / c.total : 0} />
      ))}
    </Card>
  );
}

const weekLabel = (start: IsoDate, i: number, n: number) => (n <= 8 || i % 3 === 0 ? dayOfMonth(start) : '');

function RunningCard({ data }: { data: StatsData }) {
  const p = usePalette();
  const unit = useSettings().units.distance;
  const total = data.rows.reduce((t, r) => t + r.distanceM, 0);
  const time = data.rows.reduce((t, r) => t + r.durationS, 0);
  const bars: Bar[] = data.buckets.map((b, i) => ({
    label: data.bucketUnit === 'day' ? weekdayLetter((i + 1) as Weekday) : weekLabel(b.start, i, data.buckets.length),
    parts: [
      { value: b.runM, color: p.run.color },
      { value: b.walkM, color: p.walk },
      { value: b.sprintM, color: p.sprint.color },
    ],
  }));
  return (
    <Card title="Running" right={data.bucketUnit === 'day' ? 'By day' : 'By week'}>
      <View style={{ flexDirection: 'row' }}>
        <Stat value={formatDistance(total, unit)} label="Distance" />
        <Stat value={formatMinutes(time)} label="Time" />
        <Stat value={String(data.rows.length)} label={data.rows.length === 1 ? 'Run' : 'Runs'} />
      </View>
      <StackBars bars={bars} accessibilityLabel={`Distance ${data.bucketUnit === 'day' ? 'per day' : 'per week'}, ${formatDistance(total, unit)} in total`} />
      <Legend
        items={[
          { label: 'Run', color: p.run.color },
          { label: 'Walk', color: p.walk },
          { label: 'Sprint', color: p.sprint.color },
        ]}
      />
    </Card>
  );
}

/** Heart rate progress (spec §7): Zone 2 pace, Zone 2 minutes, run share, decoupling and retests. */
function HeartCard({ data }: { data: StatsData }) {
  const s = useStyles();
  const p = usePalette();
  const unit = useSettings().units.distance;
  const h = data.heart;
  if (!h.any) return null;
  const pace = h.z2Pace;
  const first = pace[0];
  const last = pace[pace.length - 1];
  const d = first && last ? Math.round(paceToUnit(last.secPerKm, unit) - paceToUnit(first.secPerKm, unit)) : 0;
  const z2Total = h.z2Minutes.reduce((t, w) => t + w.minutes, 0);
  const z2Bars: Bar[] = h.z2Minutes.map((w, i) => ({ label: dayOfMonth(w.start), current: i === h.z2Minutes.length - 1, parts: [{ value: w.minutes, color: p.run.color }] }));
  const thisWeek = h.z2Minutes[h.z2Minutes.length - 1]?.minutes ?? 0;
  const share = h.runShare;
  const resting = data.restingHr[data.restingHr.length - 1];
  return (
    <Card title="Heart rate progress" right="Last 12 weeks">
      {last && (
        <View style={{ gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <T v="display" num>
              {formatPace(last.secPerKm, unit)}
            </T>
            {pace.length > 1 && d !== 0 && (
              <T v="labelStrong" color={d < 0 ? p.stretch.onTint : p.textSecondary}>
                {`${Math.abs(d)} s ${d < 0 ? 'faster' : 'slower'}`}
              </T>
            )}
          </View>
          <T v="caption" tone="secondary">
            Zone 2 pace
          </T>
          {pace.length > 1 && <TrendLine values={pace.map((x) => x.secPerKm)} color={p.run.color} height={56} invert accessibilityLabel={`Zone 2 pace by week, now ${formatPace(last.secPerKm, unit)}`} />}
        </View>
      )}

      {z2Total > 0 && (
        <View style={[s.section, { gap: 8 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T v="bodyMedium">Minutes in Zone 2</T>
            <T v="labelStrong" num>
              {h.z2Target !== undefined ? `${thisWeek} of ${h.z2Target} min this week` : `${thisWeek} min this week`}
            </T>
          </View>
          <StackBars bars={z2Bars} height={56} goal={h.z2Target} accessibilityLabel={`Minutes in Zone 2 per week, ${z2Total} min in 8 weeks`} />
        </View>
      )}

      {share.length > 0 && (
        <View style={[s.section, { flexDirection: 'row', justifyContent: 'space-between' }]}>
          <T v="bodyMedium">Running in run/walk</T>
          <T v="labelStrong" num>
            {share.length > 1 ? `${Math.round(share[0]!.runShare * 100)}% to ${Math.round(share[share.length - 1]!.runShare * 100)}%` : `${Math.round(share[0]!.runShare * 100)}%`}
          </T>
        </View>
      )}

      {h.decoupling.length > 0 && (
        <View style={[s.section, { gap: 6 }]}>
          <T v="bodyMedium">Decoupling on long runs</T>
          {h.decoupling.map((x) => (
            <Pressable key={x.sessionId} accessibilityRole="button" onPress={() => router.push({ pathname: '/summary/[id]', params: { id: x.sessionId } })} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="label" tone="secondary" num>
                {monthDay(x.date)}
              </T>
              <T v="labelStrong" num color={x.pct < 5 ? p.stretch.onTint : p.text}>{`${x.pct.toFixed(1)}%`}</T>
            </Pressable>
          ))}
        </View>
      )}

      {h.tests.length > 0 && (
        <View style={[s.section, { gap: 6 }]}>
          <T v="bodyMedium">Aerobic tests</T>
          {h.tests.map((t) => (
            <Pressable key={t.sessionId} accessibilityRole="button" onPress={() => router.push({ pathname: '/summary/[id]', params: { id: t.sessionId } })} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="label" tone="secondary" num>
                {monthDay(t.date)}
              </T>
              <T v="labelStrong" num>
                {[t.secPerKm !== undefined ? formatPace(t.secPerKm, unit) : undefined, t.avgBpm !== undefined ? `${Math.round(t.avgBpm)} bpm average` : undefined].filter(Boolean).join(', ') || formatMinutes(t.durationS)}
              </T>
            </Pressable>
          ))}
        </View>
      )}

      {resting && (
        <View style={[s.section, { flexDirection: 'row', justifyContent: 'space-between' }]}>
          <T v="bodyMedium">Resting heart rate</T>
          <T v="labelStrong" num>{`${resting.bpm} bpm`}</T>
        </View>
      )}
    </Card>
  );
}

function PlanWeeksCard({ data }: { data: StatsData }) {
  const p = usePalette();
  const weeks = data.adherence;
  if (weeks.every((w) => w.total === 0)) return null;
  const bars: Bar[] = weeks.map((w, i) => ({
    label: dayOfMonth(w.start),
    current: i === weeks.length - 1,
    parts: [
      { value: w.done, color: p.run.color },
      { value: w.total - w.done, color: p.ringTrack },
    ],
  }));
  const due = weeks.reduce((t, w) => t + w.total, 0);
  const done = weeks.reduce((t, w) => t + w.done, 0);
  return (
    <Card title="Plan runs by week" right={due > 0 ? `${Math.round((done / due) * 100)}% done` : undefined}>
      <StackBars bars={bars} height={64} accessibilityLabel={`Plan runs done by week, ${done} of ${due}`} />
    </Card>
  );
}

function StrengthCard({ data }: { data: StatsData }) {
  const p = usePalette();
  const weeks = data.strengthWeeks;
  const total = weeks.reduce((t, w) => t + w.count, 0);
  if (total === 0) return null;
  const bars: Bar[] = weeks.map((w, i) => ({ label: dayOfMonth(w.start), current: i === weeks.length - 1, parts: [{ value: w.count, color: p.strength.color }] }));
  const last = weeks[weeks.length - 1]!.count;
  return (
    <Card title="Strength" right={`${last} ${last === 1 ? 'session' : 'sessions'} this week`}>
      <StackBars bars={bars} height={56} accessibilityLabel={`Strength sessions per week, ${total} in 8 weeks`} />
    </Card>
  );
}

function StretchCard({ data }: { data: StatsData }) {
  const p = usePalette();
  const weeks = data.stretchWeeks;
  const total = weeks.reduce((t, w) => t + w.minutes, 0);
  if (total === 0) return null;
  const bars: Bar[] = weeks.map((w, i) => ({ label: dayOfMonth(w.start), current: i === weeks.length - 1, parts: [{ value: w.minutes, color: p.stretch.color }] }));
  const last = weeks[weeks.length - 1]!.minutes;
  return (
    <Card title="Stretching" right={`${last} min this week`}>
      {data.stretchThisWeek.map((r) => (
        <View key={r.name} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T v="bodyMedium">{r.name}</T>
          <T v="labelStrong" num>{`${r.days} of 7 days`}</T>
        </View>
      ))}
      <StackBars bars={bars} height={56} accessibilityLabel={`Minutes stretched per week, ${total} min in 8 weeks`} />
    </Card>
  );
}

function StepsCard({ data }: { data: StatsData }) {
  const p = usePalette();
  const goal = useSettings().stepGoal;
  const days = data.metrics.filter((m) => m.steps !== undefined);
  if (days.length === 0) return null;
  const avg = Math.round(days.reduce((t, m) => t + (m.steps ?? 0), 0) / days.length);
  const stepsOn = new Map(days.map((m) => [m.date, m.steps ?? 0]));
  let bars: Bar[];
  if (data.bucketUnit === 'day') {
    bars = data.buckets.map((b, i) => {
      const v = stepsOn.get(b.start) ?? 0;
      return { label: weekdayLetter((i + 1) as Weekday), parts: [{ value: v, color: v >= goal ? p.success : p.steps }] };
    });
  } else {
    // A week's daily average, against the daily goal.
    bars = data.buckets.map((b, i) => {
      const inWeek = days.filter((m) => m.date >= b.start && m.date < addDays(b.start, 7));
      const v = inWeek.length ? Math.round(inWeek.reduce((t, m) => t + (m.steps ?? 0), 0) / inWeek.length) : 0;
      return { label: weekLabel(b.start, i, data.buckets.length), parts: [{ value: v, color: v >= goal ? p.success : p.steps }] };
    });
  }
  return (
    <Card title="Steps" right={`${thousands(avg)} a day on average`}>
      <StackBars bars={bars} height={70} goal={goal} accessibilityLabel={`Steps, ${thousands(avg)} a day on average, goal ${thousands(goal)}`} />
      <T v="micro" tone="tertiary">{`Goal ${thousands(goal)} steps a day`}</T>
    </Card>
  );
}

function RestingHrCard({ data }: { data: StatsData }) {
  const p = usePalette();
  const hr = data.restingHr;
  if (hr.length === 0) return null;
  const first = hr[0]!;
  const last = hr[hr.length - 1]!;
  const d = last.bpm - first.bpm;
  return (
    <Card title="Resting heart rate" right="Last 90 days">
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
        <T v="display" num>{`${last.bpm} bpm`}</T>
        {hr.length > 1 && d !== 0 && (
          <T v="labelStrong" color={d < 0 ? p.stretch.onTint : p.textSecondary}>
            {`${Math.abs(d)} bpm ${d < 0 ? 'lower' : 'higher'}`}
          </T>
        )}
      </View>
      {hr.length > 1 ? (
        <>
          <TrendLine values={hr.map((x) => x.bpm)} color={p.sprint.color} accessibilityLabel={`Resting heart rate over 90 days, now ${last.bpm} bpm`} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T v="tiny" tone="tertiary">
              {monthDay(first.date)}
            </T>
            <T v="tiny" tone="tertiary">
              {monthDay(last.date)}
            </T>
          </View>
        </>
      ) : (
        <T v="tiny" tone="tertiary">
          {monthDay(last.date)}
        </T>
      )}
    </Card>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  section: { borderTopWidth: 1, borderTopColor: p.divider, paddingTop: 10 },
}));
