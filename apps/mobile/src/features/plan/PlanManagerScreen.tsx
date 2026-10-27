/**
 * Run plan manager (spec §14): goal and race day, weekly volume across the plan, training
 * paces with Re-test, and one week's runs with their structure. Opened from the plan card.
 */
import { type AgendaItem, type PlanSummary, type WeekKind, type Weekday, formatClock, formatDistance, formatMinutes, metersToUnit, presetInfo, weekKind, weekdayOf } from '@fit/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { repo } from '@/data';
import { actions, showSnack, useFit, usePlan, useToday, useUnits } from '@/data/store';
import { openItemSheet } from '@/features/items/ItemSheet';
import { PaceTable, sourceLabel } from '@/features/pace/paces';
import { type Bar, Card, StackBars, Stat } from '@/features/stats/charts';
import { monthDay, weekdayShort } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { NotFound } from '@/ui/NotFound';
import { Button, Chip, IconButton, StructureBar, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { StatusShade } from '@/ui/StatusShade';

/** The plan's runs, every week, from the store (the screen loads the plan's date range). */
function usePlanRuns(planId: string | undefined): AgendaItem[] {
  return useFit(useShallow((s) => (planId ? Object.values(s.items).filter((i) => i.source.type === 'plan_workout' && i.source.planId === planId) : [])));
}

/** Plan week of a run; weekIndex is already 1-based. */
const weekOf = (i: AgendaItem) => (i.source.type === 'plan_workout' ? i.source.weekIndex : 0);

export function PlanManagerScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const plan = usePlan();
  const today = useToday();
  const units = useUnits();
  const runs = usePlanRuns(plan?.id);
  const [daysOpen, setDaysOpen] = useState(false);
  const [week, setWeek] = useState(() => (plan && today >= plan.startDate ? plan.currentWeek : 1));

  useEffect(() => {
    if (plan) actions.ensureRange(plan.startDate, plan.endDate);
  }, [plan?.startDate, plan?.endDate]);

  if (!plan) return <NotFound message="No running plan" />;

  const info = presetInfo(plan.presetId);
  const started = today >= plan.startDate;
  const byMinutes = plan.measure.kind === 'z2_minutes';
  const volumeOf = (items: AgendaItem[]) => (byMinutes ? items.reduce((t, i) => t + i.estSeconds / 60, 0) : items.reduce((t, i) => t + (i.estMeters ?? 0), 0));
  const volumeText = (v: number) => (byMinutes ? formatMinutes(v * 60) : formatDistance(v, units.distance));
  const weeks = Array.from({ length: plan.weeks }, (_, i) => runs.filter((r) => weekOf(r) === i + 1));
  const kinds = weeks.map((_, i) => weekKind(i + 1, plan.weeks, info.cutbackEvery, info.taperWeeks));
  const bars: Bar[] = weeks.map((w, i) => ({
    label: plan.weeks > 12 && i % 2 === 1 ? '' : `W${i + 1}`,
    current: i + 1 === week,
    parts: [{ value: byMinutes ? volumeOf(w) : metersToUnit(volumeOf(w), units.distance), color: kinds[i] === 'build' ? p.run.color : p.run.pending }],
  }));
  const kindWeeks = (k: WeekKind) => kinds.flatMap((x, i) => (x === k ? [i + 1] : []));
  const lighter = [kindWeeks('cutback').length > 0 ? `Cutback ${andList(kindWeeks('cutback'))}` : undefined, kindWeeks('taper').length > 0 ? `taper ${andList(kindWeeks('taper'))}` : undefined]
    .filter(Boolean)
    .join(', ');
  const shown = (weeks[week - 1] ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));

  const go = (n: number) => {
    haptic.tick();
    setWeek(Math.min(plan.weeks, Math.max(1, week + n)));
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
        </View>

        <View style={{ gap: 2 }}>
          <T v="label" tone="secondary">
            {started ? `Running plan, week ${plan.currentWeek} of ${plan.weeks}` : `Running plan, starts ${monthDay(plan.startDate)}`}
          </T>
          <T v="display" accessibilityRole="header">
            {plan.name}
          </T>
        </View>
        <GoalStats plan={plan} />

        <Card title={byMinutes ? 'Weekly minutes' : units.distance === 'mi' ? 'Weekly miles' : 'Weekly kilometers'} right={`${plan.weeks} weeks`}>
          <StackBars bars={bars} height={64} accessibilityLabel={`Planned volume by week, ${plan.weeks} weeks${lighter ? `, ${lighter}` : ''}`} />
          {lighter !== '' && (
            <T v="caption" tone="secondary">
              {lighter.charAt(0).toUpperCase() + lighter.slice(1)}
            </T>
          )}
        </Card>

        <Paces beginner={info.beginner} />

        <Card>
          <View style={s.weekHead}>
            <IconButton label="Previous week" size={36} onPress={() => go(-1)} style={{ opacity: week > 1 ? 1 : 0.3 }}>
              <Icons.chevronLeft size={18} color={p.text} />
            </IconButton>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <T v="bodyStrong">{`Week ${week}`}</T>
              <T v="caption" tone="secondary" num>
                {`${volumeText(volumeOf(shown))}, ${shown.length} ${shown.length === 1 ? 'run' : 'runs'}`}
              </T>
            </View>
            <IconButton label="Next week" size={36} onPress={() => go(1)} style={{ opacity: week < plan.weeks ? 1 : 0.3 }}>
              <Icons.chevronRight size={18} color={p.text} />
            </IconButton>
          </View>
          {shown.map((r, i) => (
            <RunRow key={r.key} item={r} first={i === 0} />
          ))}
        </Card>

        <View style={{ gap: 8 }}>
          <Button
            label="Shift the rest of this week by a day"
            kind="outline"
            onPress={() => {
              haptic.commit();
              actions.shiftRestOfWeek();
              showSnack({ message: 'Rest of this week moved a day later' });
            }}
          />
          {info.kind !== 'race' && (
            <Button
              label="Push plan back a week"
              kind="outline"
              onPress={() => {
                haptic.commit();
                actions.pushPlanBack();
                showSnack({ message: 'Plan pushed back a week' });
              }}
            />
          )}
          <Button label="Change run days" kind="outline" onPress={() => setDaysOpen(true)} />
          <Button label="Change plan" kind="quiet" onPress={() => router.push({ pathname: '/setup', params: { only: 'plan' } })} />
        </View>
      </ScrollView>
      <StatusShade />
      {/* Keyed on open, so it starts from the plan's current days each time. */}
      <RunDaysSheet key={String(daysOpen)} plan={plan} open={daysOpen} onClose={() => setDaysOpen(false)} />
    </View>
  );
}

/** "2, 4 and 6". */
function andList(ns: readonly number[]): string {
  return ns.length < 2 ? ns.join('') : `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`;
}

const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Run days and the long run day; upcoming runs move inside their weeks, nothing is rebuilt. */
function RunDaysSheet({ plan, open, onClose }: { plan: PlanSummary; open: boolean; onClose: () => void }) {
  const p = usePalette();
  const today = useToday();
  const [days, setDays] = useState<Weekday[]>(plan.inputs.preferredDays);
  const [long, setLong] = useState<Weekday>(plan.inputs.longRunDay);
  const [error, setError] = useState<string>();
  const runs = plan.inputs.daysPerWeek;
  const toggle = (d: Weekday) => {
    haptic.tick();
    setError(undefined);
    setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b));
  };
  const save = () => {
    const picked = days.includes(long) ? days : [...days, long].sort((a, b) => a - b);
    try {
      repo.changeRunDays(picked, long, today);
    } catch {
      haptic.warn();
      setError(`These days cannot hold ${runs} runs a week with rest between hard days. Pick more days.`);
      return;
    }
    actions.reload();
    haptic.commit();
    showSnack({ message: 'Run days changed' });
    onClose();
  };
  return (
    <Sheet visible={open} onClose={onClose} title="Change run days">
      <View style={{ gap: 14 }}>
        <View style={{ gap: 8 }}>
          <T v="labelStrong" tone="secondary">{`Run days, ${runs} runs a week`}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WEEK.map((d) => (
              <Chip key={d} label={weekdayShort(d)} on={days.includes(d)} onPress={() => toggle(d)} />
            ))}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <T v="labelStrong" tone="secondary">
            Long run
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WEEK.map((d) => (
              <Chip
                key={d}
                label={weekdayShort(d)}
                on={long === d}
                onPress={() => {
                  haptic.tick();
                  setError(undefined);
                  setLong(d);
                }}
              />
            ))}
          </View>
        </View>
        {error && (
          <T v="caption" color={p.sprint.onTint}>
            {error}
          </T>
        )}
        <Button label="Save" disabled={days.length < runs} onPress={save} />
      </View>
    </Sheet>
  );
}

function GoalStats({ plan }: { plan: PlanSummary }) {
  const race = plan.inputs.raceDate;
  const goal = plan.inputs.goalSeconds;
  const end = race ?? plan.endDate;
  return (
    <View style={{ flexDirection: 'row' }}>
      {goal !== undefined && <Stat value={formatClock(goal)} label="Goal time" />}
      <Stat value={`${weekdayShort(weekdayOf(end))}, ${monthDay(end)}`} label={race ? 'Race day' : 'Last day'} />
      {goal === undefined && <Stat value={`${plan.inputs.daysPerWeek}`} label="Runs a week" />}
    </View>
  );
}

function Paces({ beginner }: { beginner: boolean }) {
  const unit = useUnits().distance;
  const [profile] = useState(() => repo.paceProfile());
  if (beginner || !profile) return null;
  return (
    <Card title="Training paces">
      <PaceTable vdot={profile.vdot} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T v="caption" tone="secondary" style={{ flex: 1 }}>
          {sourceLabel(profile, unit)}
        </T>
        <Button label="Re-test" kind="outline" size="sm" style={{ borderRadius: 18 }} onPress={() => router.push('/pace')} />
      </View>
    </Card>
  );
}

function RunRow({ item, first }: { item: AgendaItem; first: boolean }) {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().distance;
  const done = item.status === 'done';
  const meta = [item.estMeters ? formatDistance(item.estMeters, unit) : undefined, formatMinutes(item.estSeconds), done ? 'Done' : item.status === 'skipped' ? 'Skipped' : undefined].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${weekdayShort(weekdayOf(item.date))}, ${item.title}, ${meta}`}
      onPress={() => {
        haptic.tap();
        openItemSheet(item.key);
      }}
      style={[s.run, !first && s.divider, item.status !== 'pending' && { opacity: 0.5 }]}
    >
      <T v="labelStrong" tone="secondary" style={{ width: 40 }}>
        {weekdayShort(weekdayOf(item.date))}
      </T>
      <View style={{ flex: 1, gap: 6 }}>
        <View>
          <T v="bodyMedium">{item.title}</T>
          <T v="caption" tone="secondary" num>
            {meta}
          </T>
        </View>
        {item.structure && item.structure.length > 0 && <StructureBar segments={item.structure} height={6} />}
      </View>
      <Icons.chevronRight size={14} color={p.textTertiary} />
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center' },
  weekHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  run: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
