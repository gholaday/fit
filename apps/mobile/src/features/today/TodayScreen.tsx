import { type IsoDate, addDays, formatClock, formatDistance, formatMinutes, localIsoDate, weekdayOf } from '@fit/core';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { repo } from '@/data';
import { actions, showSnack, useDataVersion, useDayKeys, useFit, usePaceBump, useSettings, useToday } from '@/data/store';
import { PaceBumpCard } from '@/features/pace/paces';
import { ACTIVITY_ICON, ACTIVITY_LABEL } from '@/features/health/ActivityModal';
import { openActivities, reloadHealth, useHealth } from '@/features/health/state';
import { syncHealth } from '@/features/health/sync';
import { QuickLogSheet, quickLogLabel } from '@/features/quicklog/QuickLogSheet';
import { haptic } from '@/lib/haptics';
import { longDate, weekdayLong } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons, QUICK_LOG_ICON } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { ChecklistCard } from './ChecklistCard';
import { DayWidget, type DayWidgetHandle, SlimBar } from './DayWidget';
import { type DoneActivity, DoneActivityCard } from './DoneActivityCard';
import { summarizeDay } from './daySummary';
import { StepsCard } from './StepsCard';
import { StartWorkoutSheet } from './StartWorkoutSheet';
import { WeekStrip } from './WeekStrip';

/** Scroll distance after which the widget has collapsed into the slim bar. */
const COLLAPSE_FROM = 150;
const COLLAPSE_TO = 200;

/** A logged activity to delete, with what deleting it does. */
interface Deleting {
  title: string;
  note: string;
  run: () => void;
}

/**
 * Rows logged on a day. Takes the data version so the compiler's memo re-reads after a
 * write; a manual deps entry the callback never reads gets dropped.
 */
function loggedOn(day: IsoDate, _version: number) {
  const before = new Date(`${addDays(day, 1)}T00:00:00`).toISOString();
  return {
    // Every recorded session: runs, walks and lifting.
    sessions: repo
      .history({ source: 'fit', before, limit: 30 })
      .filter((r) => localIsoDate(new Date(r.startedAt)) === day)
      .reverse(),
    watch: repo.externalSessions(day, day).filter((x) => !x.linkedPlanKey),
    logs: repo.quickLogs(day, day),
  };
}

function dayTitle(day: IsoDate, today: IsoDate): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return weekdayLong(weekdayOf(day));
}

export function TodayScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const [picked, setPicked] = useState<IsoDate>();
  // A day picked before midnight follows "today" once the date changes.
  const day = picked ?? today;
  const isToday = day === today;
  const settings = useSettings();
  const keys = useDayKeys(day);
  const items = useFit(useShallow((st) => keys.map((k) => st.items[k]!)));
  const tomorrowItems = useFit(useShallow((st) => (st.byDate[addDays(today, 1)] ?? []).map((k) => st.items[k]!)));
  const summary = summarizeDay(items, tomorrowItems, new Date().getHours(), settings.units);
  const version = useDataVersion();
  const unit = settings.units.distance;
  const [deleting, setDeleting] = useState<Deleting>();

  const select = (d: IsoDate) => {
    actions.ensureRange(d, d);
    setPicked(d === today ? undefined : d);
  };

  // Everything else logged on the day, under the checklist: recorded sessions (runs and
  // lifting) and watch activities no plan item claims, and quick logs. Long press deletes them.
  const logged = useMemo(() => loggedOn(day, version), [day, version]);
  const done = useMemo<DoneActivity[]>(() => {
    const claimed = new Set(items.flatMap((i) => [i.sessionId, i.externalSessionId]).filter(Boolean));
    const ask = (d: Deleting) => () => setDeleting(d);
    const sessions = logged.sessions
      .filter((r) => !claimed.has(r.id))
      .map((r): DoneActivity => {
        if (r.kind === 'strength') {
          return {
            key: r.id,
            title: r.name,
            detail: formatMinutes(r.durationS),
            type: 'strength',
            icon: Icons.barbell,
            onPress: () => router.push({ pathname: '/lift/[id]', params: { id: r.id } }),
            onDelete: ask({ title: r.name, note: 'The sets are deleted.', run: () => repo.deleteSession(r.id) }),
          };
        }
        const time = formatClock(r.durationS);
        return {
          key: r.id,
          title: r.name,
          detail: r.distanceM && r.distanceM > 20 ? `${formatDistance(r.distanceM, unit, 2)}, ${time}` : time,
          type: 'run',
          icon: Icons.run,
          onPress: () => router.push({ pathname: '/summary/[id]', params: { id: r.id } }),
          onDelete: ask({ title: r.name, note: 'The route and stats are deleted.', run: () => repo.deleteSession(r.id) }),
        };
      });
    const watch = logged.watch
      .filter((x) => !claimed.has(x.id))
      .map((x): DoneActivity => {
        const minutes = formatMinutes((Date.parse(x.endedAt) - Date.parse(x.startedAt)) / 1000);
        const title = x.title || ACTIVITY_LABEL[x.activity];
        return {
          key: x.id,
          title,
          detail: x.distanceM ? `${formatDistance(x.distanceM, unit, 2)}, ${minutes}` : minutes,
          type: x.activity,
          icon: ACTIVITY_ICON[x.activity],
          onPress: () => router.push({ pathname: '/activity/[id]', params: { id: x.id } }),
          onDelete: ask({
            title,
            note: 'It is removed from Fit and not imported again. Your watch keeps it.',
            run: () => {
              repo.deleteExternal(x.id);
              reloadHealth();
            },
          }),
        };
      });
    const logs = logged.logs.map((l): DoneActivity => {
      const title = quickLogLabel(l.activityType);
      return {
        key: l.id,
        title,
        detail: l.distanceM ? `${formatDistance(l.distanceM, unit, 2)}, ${formatMinutes(l.minutes * 60)}` : formatMinutes(l.minutes * 60),
        type: l.activityType,
        icon: QUICK_LOG_ICON[l.activityType],
        onDelete: ask({ title, note: 'The quick log is removed.', run: () => repo.deleteQuickLog(l.id) }),
      };
    });
    return [...sessions, ...watch, ...logs];
  }, [logged, items, unit]);

  const heroKey = isToday ? items.find((i) => i.lane === 'run' && i.status === 'pending')?.key : undefined;
  const [quickLog, setQuickLog] = useState(false);
  const [startWorkout, setStartWorkout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void syncHealth().finally(() => setRefreshing(false));
  };
  const metrics = useHealth((h) => h.metrics);
  const lastSyncedAt = useHealth((h) => h.lastSyncedAt);
  const pendingCount = useHealth((h) => h.pending.length);
  const bump = usePaceBump();

  const confirmDelete = () => {
    if (!deleting) return;
    deleting.run();
    actions.reload();
    haptic.commit();
    showSnack({ message: `${deleting.title} deleted` });
    setDeleting(undefined);
  };

  // The day widget's lane rows scroll the checklist to a card, clear of the slim bar.
  const widget = useRef<DayWidgetHandle>(null);
  const scroll = useAnimatedRef<Animated.ScrollView>();
  const cardY = useRef<Record<string, number>>({});
  const jump = (key: string) => {
    const y = cardY.current[key];
    if (y === undefined) return;
    haptic.tap();
    scroll.current?.scrollTo({ y: Math.max(0, y - insets.top - 72), animated: true });
  };

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const slimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [-8, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={s.screen} onTouchStart={(e) => widget.current?.touch(e.nativeEvent.pageX, e.nativeEvent.pageY)}>
      <Animated.ScrollView ref={scroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <T v="label" tone="secondary">
              {longDate(day)}
            </T>
            <T v="display" accessibilityRole="header">
              {dayTitle(day, today)}
            </T>
          </View>
          {isToday ? (
            <Button label="Quick log" kind="outline" size="sm" style={{ borderRadius: 18 }} icon={<Icons.plus size={14} color={p.text} />} onPress={() => setQuickLog(true)} />
          ) : (
            <Button label="Back to today" kind="outline" size="sm" style={{ borderRadius: 18 }} onPress={() => select(today)} />
          )}
          <IconButton label="Settings" bg="none" onPress={() => router.push('/settings')}>
            <Icons.settings size={22} color={p.text} />
          </IconButton>
        </View>

        <WeekStrip today={today} selected={day} onSelect={select} />
        {isToday && <DayWidget ref={widget} today={today} summary={summary} items={items} units={settings.units} onJump={jump} onDay={select} />}
        {isToday && <StepsCard today={today} steps={metrics?.steps} goal={settings.stepGoal} lastSyncedAt={lastSyncedAt} />}
        {isToday && bump && <PaceBumpCard bump={bump} />}
        {pendingCount > 0 && (
          <Button
            label={`New activities (${pendingCount})`}
            kind="outline"
            size="sm"
            style={{ alignSelf: 'flex-start', borderRadius: 18 }}
            icon={<Icons.bell size={14} color={p.text} />}
            onPress={() => {
              haptic.tap();
              openActivities();
            }}
          />
        )}

        {items.length === 0 && done.length === 0 ? (
          <View style={s.empty}>
            <T v="bodyMedium" tone="secondary">
              {isToday ? 'Nothing planned today' : day < today ? 'Nothing logged' : 'Nothing planned'}
            </T>
            {isToday && (
              <T v="caption" tone="tertiary" align="center">
                Add routines on the Plan tab under Schedule.
              </T>
            )}
          </View>
        ) : (
          items.map((i) => (
            <View
              key={i.key}
              onLayout={(e) => {
                cardY.current[i.key] = e.nativeEvent.layout.y;
              }}
            >
              <ChecklistCard itemKey={i.key} hero={i.key === heroKey} />
            </View>
          ))
        )}
        {done.map((a) => (
          <DoneActivityCard key={a.key} activity={a} />
        ))}

        {isToday && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
            <Button label="Free run" kind="quiet" size="md" style={{ flex: 1 }} icon={<Icons.run size={18} color={p.text} />} onPress={() => router.push('/run')} />
            <Button label="Workout" kind="quiet" size="md" style={{ flex: 1 }} icon={<Icons.barbell size={18} color={p.text} />} onPress={() => setStartWorkout(true)} />
          </View>
        )}
      </Animated.ScrollView>

      {isToday && (
        <Animated.View pointerEvents="none" style={[s.slimWrap, { paddingTop: insets.top + 4 }, slimStyle]}>
          <View style={s.slim}>
            <SlimBar summary={summary} steps={metrics?.steps} />
          </View>
        </Animated.View>
      )}
      {/* Keeps scrolled content from showing under the transparent status bar. */}
      <View pointerEvents="none" style={[s.statusBar, { height: insets.top }]} />

      <QuickLogSheet visible={quickLog} onClose={() => setQuickLog(false)} />
      <StartWorkoutSheet visible={startWorkout} onClose={() => setStartWorkout(false)} />
      <Sheet visible={!!deleting} onClose={() => setDeleting(undefined)} title={deleting ? `Delete ${deleting.title}` : ''}>
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            {deleting?.note ?? ''}
          </T>
          <Button label="Delete" onPress={confirmDelete} />
          <Button label="Keep it" kind="outline" onPress={() => setDeleting(undefined)} />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 4 },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: p.bg },
  slimWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 8, backgroundColor: p.bg },
  slim: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, borderRadius: 14 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 32 },
}));
