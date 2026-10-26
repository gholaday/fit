import { type IsoDate, type PlanSummary, addDays, formatDistance, startOfWeek } from '@fit/core';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, usePlan, useToday, useUnits } from '@/data/store';
import { dateRangeLabel, monthDay } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, motion, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, LaneTile, Segmented, T } from '@/ui/primitives';
import { ScheduleTab } from './ScheduleTab';
import { WeekGrid } from './WeekGrid';
import { StatusShade } from '@/ui/StatusShade';

type Tab = 'week' | 'schedule';

export function PlanScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const [tab, setTab] = useState<Tab>('week');
  const [scheduleSeen, setScheduleSeen] = useState(false);
  const [weekStart, setWeekStart] = useState<IsoDate>(() => startOfWeek(today));

  // Keep this week and the next loaded (the drop target and the Move picker use both).
  useEffect(() => actions.ensureRange(addDays(weekStart, -7), addDays(weekStart, 13)), [weekStart]);

  const go = (weeks: number) => {
    haptic.tick();
    setWeekStart(addDays(weekStart, weeks * 7));
  };

  return (
    <>
      <ScrollView style={s.screen} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <T v="display" style={{ flex: 1 }} accessibilityRole="header">
            Plan
          </T>
          <IconButton label="Settings" bg="none" onPress={() => router.push('/settings')}>
            <Icons.settings size={22} color={p.text} />
          </IconButton>
        </View>
  
        <Segmented
          options={[
            { value: 'week', label: 'This week' },
            { value: 'schedule', label: 'Schedule' },
          ]}
          value={tab}
          onChange={(t) => {
            setTab(t);
            if (t === 'schedule') setScheduleSeen(true);
          }}
        />
  
        {/* Both stay mounted once seen, so switching back is instant. */}
        <View style={{ display: tab === 'week' ? 'flex' : 'none', gap: 14 }}>
          <PlanCard />
          <View style={s.nav}>
            <IconButton label="Previous week" onPress={() => go(-1)}>
              <Icons.chevronLeft size={18} color={p.text} />
            </IconButton>
            <Animated.View key={weekStart} entering={FadeIn.duration(motion.fast)} style={{ alignItems: 'center' }}>
              <T v="bodyStrong">{dateRangeLabel(weekStart, addDays(weekStart, 6))}</T>
              <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
                {weekStart < startOfWeek(today) ? 'Past week' : 'Hold and drag to move a day'}
              </T>
            </Animated.View>
            <IconButton label="Next week" onPress={() => go(1)}>
              <Icons.chevronRight size={18} color={p.text} />
            </IconButton>
          </View>
          <Animated.View key={weekStart} entering={FadeIn.duration(motion.base)}>
            <WeekGrid weekStart={weekStart} today={today} />
          </Animated.View>
          {weekStart !== startOfWeek(today) && <Button label="Back to this week" kind="quiet" size="sm" style={{ alignSelf: 'center' }} onPress={() => setWeekStart(startOfWeek(today))} />}
        </View>
        {(tab === 'schedule' || scheduleSeen) && (
          <View style={{ display: tab === 'schedule' ? 'flex' : 'none' }}>
            <ScheduleTab />
          </View>
        )}
      </ScrollView>
      <StatusShade />
    </>
  );
}

function measureText(plan: PlanSummary, unit: 'mi' | 'km'): { frac: number; text: string } {
  const m = plan.measure;
  if (m.kind === 'z2_minutes') {
    return { frac: m.planned > 0 ? m.done / m.planned : 0, text: `${m.done} of ${m.planned} min in Zone 2 this week` };
  }
  return { frac: m.plannedM > 0 ? m.doneM / m.plannedM : 0, text: `${formatDistance(m.doneM, unit)} of ${formatDistance(m.plannedM, unit)} this week` };
}

function PlanCard() {
  const s = useStyles();
  const p = usePalette();
  const plan = usePlan();
  const units = useUnits();
  const today = useToday();
  if (!plan) {
    return (
      <View style={s.card}>
        <LaneTile lane="run" />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">No running plan</T>
          <T v="caption" tone="secondary">
            Runs from a plan show in the Run lane
          </T>
        </View>
        <Button label="Pick a plan" kind="outline" size="sm" onPress={() => router.push({ pathname: '/setup', params: { only: 'plan' } })} />
      </View>
    );
  }
  const { frac, text } = measureText(plan, units.distance);
  return (
    <View style={s.card}>
      <LaneTile lane="run" />
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T v="bodyStrong">{plan.name}</T>
          <T v="caption" tone="secondary">
            {today < plan.startDate ? `Starts ${monthDay(plan.startDate)}` : `Week ${plan.currentWeek} of ${plan.weeks}`}
          </T>
        </View>
        <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(frac * 100) }}>
          <View style={{ width: `${Math.min(100, Math.round(frac * 100))}%`, height: '100%', backgroundColor: p.run.color }} />
        </View>
        <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
          {text}
        </T>
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center' },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  track: { height: 4, borderRadius: 2, backgroundColor: p.ringTrack, overflow: 'hidden' },
  nav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
}));
