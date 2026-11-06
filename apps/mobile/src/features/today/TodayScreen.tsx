/**
 * Today, the Orbit layout (spec §14, design canvas A2 and A-Scrolled): the header, the week
 * strip, the day ring with its lane cards and stats, and the action pill. Scrolling
 * collapses the header and ring into a slim bar and shows a card per item, the steps and
 * weight cards and Up next.
 */
import { type AgendaItem, type IsoDate, type Lane, type RingHit, addDays, dayRing, diffDays, formatClock, formatDistance, formatMinutes, localIsoDate, weekdayOf } from '@fit/core';
import { router } from 'expo-router';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, RefreshControl, View, useWindowDimensions } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { repo } from '@/data';
import { actions, showSnack, useDataVersion, useDayKeys, useFit, usePaceBump, usePlan, useSettings, useToday } from '@/data/store';
import { ACTIVITY_ICON, ACTIVITY_LABEL } from '@/features/health/ActivityModal';
import { openActivities, reloadHealth, useHealth } from '@/features/health/state';
import { syncHealth } from '@/features/health/sync';
import { PaceBumpCard } from '@/features/pace/paces';
import { QuickLogSheet, quickLogLabel } from '@/features/quicklog/QuickLogSheet';
import { WeightCard } from '@/features/weight/WeightCard';
import { WeighInSheet } from '@/features/weight/WeightSheets';
import { clockTime, monthDay, thousands, weekdayLong } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, usePalette } from '@/theme';
import { Icons, QUICK_LOG_ICON } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { ActionPill } from './ActionPill';
import { ChecklistCard } from './ChecklistCard';
import { type DoneActivity, DoneActivityCard } from './DoneActivityCard';
import { LaneCards, LaneDetail } from './LaneCards';
import { LANE_NAME } from './lanes';
import { DoneCards, RestCards, SlimBar, StatsRow, UpNext, dayTotals } from './OrbitParts';
import { type OrbitArc, OrbitRing, laneArcs } from './OrbitRing';
import { StepsCard } from './StepsCard';
import { WeekStrip } from './WeekStrip';

/** Scroll distance over which the header and ring give way to the slim bar. */
const COLLAPSE_FROM = 300;
const COLLAPSE_TO = 360;
const RING_MAX = 290;

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

/** "Nov 4, week 5 of 12", "Nov 6, rest day" or "Nov 4". */
function subtitle(day: IsoDate, rest: boolean, plan: ReturnType<typeof usePlan>): string {
  if (rest) return `${monthDay(day)}, rest day`;
  if (plan && day >= plan.startDate && day <= plan.endDate) return `${monthDay(day)}, week ${Math.floor(diffDays(plan.startDate, day) / 7) + 1} of ${plan.weeks}`;
  return monthDay(day);
}

export function TodayScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const ringSize = Math.min(RING_MAX, width - 64);
  const today = useToday();
  const [picked, setPicked] = useState<IsoDate>();
  // A day picked before midnight follows "today" once the date changes.
  const day = picked ?? today;
  const isToday = day === today;
  const settings = useSettings();
  const plan = usePlan();
  const keys = useDayKeys(day);
  const items = useFit(useShallow((st) => keys.map((k) => st.items[k]!)));
  const tomorrow = addDays(day, 1);
  const tomorrowItems = useFit(useShallow((st) => (st.byDate[tomorrow] ?? []).map((k) => st.items[k]!)));
  const version = useDataVersion();
  const unit = settings.units.distance;
  const [deleting, setDeleting] = useState<Deleting>();
  const [focus, setFocus] = useState<Lane>();

  const select = (d: IsoDate) => {
    actions.ensureRange(d, addDays(d, 1));
    setFocus(undefined);
    setPicked(d === today ? undefined : d);
  };

  // Coming back to the app starts from the plain view.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setFocus(undefined));
    return () => sub.remove();
  }, []);

  const metrics = useHealth((h) => h.metrics);
  const lastSyncedAt = useHealth((h) => h.lastSyncedAt);
  const pendingCount = useHealth((h) => h.pending.length);
  const bump = usePaceBump();
  // Health metrics are today's; another day reads its stored row.
  const steps = isToday ? metrics?.steps : repo.dailyMetrics(day)?.steps;

  const rings = dayRing(items, 0);
  const total = items.length;
  const done = items.filter((i) => i.status === 'done').length;
  const resolved = items.every((i) => i.status !== 'pending');
  const rest = total === 0;
  const allDone = total > 0 && done === total;
  const next = isToday ? items.find((i) => i.status === 'pending') : undefined;
  const totals = useMemo(() => dayTotals(day, items, version), [day, items, version]);

  const stepFill = Math.min(1, (steps ?? 0) / Math.max(1, settings.stepGoal));
  const stepsArc: OrbitArc = { key: 'steps', start: 0, end: 1, fill: stepFill, color: p.steps, track: p.run.tint, focusTrack: p.run.tint, grad: p.grad.steps };
  const arcs = rest ? [stepsArc] : laneArcs(rings, p);
  const focusArc = focus ? rings.find((a) => a.lane === focus) : undefined;

  const onHit = (hit: RingHit | undefined) => {
    haptic.tick();
    setFocus((cur) => (hit?.ring === 'day' && cur !== hit.lane ? hit.lane : undefined));
  };

  // A touch outside the ring and the card under it leaves lane focus.
  const orbit = useRef<ComponentRef<typeof View>>(null);
  const touch = (x: number, y: number) => {
    if (!focus) return;
    orbit.current?.measureInWindow((bx, by, w, h) => {
      if (x < bx || x > bx + w || y < by || y > by + h) setFocus(undefined);
    });
  };

  // Everything else logged on the day, under the item cards: recorded sessions (runs and
  // lifting) and watch activities no plan item claims, and quick logs. Long press deletes them.
  const logged = useMemo(() => loggedOn(day, version), [day, version]);
  const others = useMemo<DoneActivity[]>(() => {
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
            note: 'It is removed from Orbit and not imported again. Your watch keeps it.',
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
  const [weighIn, setWeighIn] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void syncHealth().finally(() => setRefreshing(false));
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleting.run();
    actions.reload();
    haptic.commit();
    showSnack({ message: `${deleting.title} deleted` });
    setDeleting(undefined);
  };

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const slimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [-8, 0], Extrapolation.CLAMP) }],
  }));

  const ringLabel = rest
    ? `Rest day. ${thousands(steps ?? 0)} of ${thousands(settings.stepGoal)} steps`
    : `Day ring: ${rings.map((a) => `${LANE_NAME[a.lane]} ${a.done} of ${a.total} done`).join(', ')}`;

  return (
    <View style={s.screen} onTouchStart={(e) => touch(e.nativeEvent.pageX, e.nativeEvent.pageY)}>
      <Animated.ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[s.content, { paddingTop: insets.top + 12, paddingBottom: isToday ? 104 : 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <T v="title" accessibilityRole="header">
              {weekdayLong(weekdayOf(day))}
            </T>
            <T v="label" tone="secondary" num>
              {subtitle(day, rest, plan)}
            </T>
          </View>
          <IconButton label="Settings" size={44} onPress={() => router.push('/settings')} style={s.settings}>
            <Icons.settings size={20} color={p.textSecondary} />
          </IconButton>
        </View>

        <WeekStrip today={today} selected={day} onSelect={select} />

        <View ref={orbit} style={{ gap: 16 }}>
          <View style={{ alignItems: 'center', marginTop: 2 }}>
            <OrbitRing size={ringSize} arcs={arcs} lanes={rest ? [] : rings} focus={focus} strong={allDone} onHit={rest ? undefined : onHit} label={ringLabel}>
              <RingCenter rest={rest} steps={steps} goal={settings.stepGoal} focus={focus} focusArc={focusArc} allDone={allDone} done={done} total={total} next={next} isToday={isToday} />
            </OrbitRing>
          </View>

          {focus ? (
            <LaneDetail lane={focus} items={items.filter((i) => i.lane === focus)} />
          ) : rest ? (
            <RestCards tomorrow={tomorrowItems} />
          ) : resolved ? (
            <DoneCards day={day} totals={totals} tomorrow={tomorrowItems} />
          ) : (
            <>
              <LaneCards arcs={rings} items={items} units={settings.units} onFocus={setFocus} />
              <StatsRow steps={steps} activeS={totals.activeS} />
            </>
          )}
        </View>

        <View style={s.below}>
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
          {items.map((i) => (
            <ChecklistCard key={i.key} itemKey={i.key} hero={i.key === heroKey} />
          ))}
          {others.map((a) => (
            <DoneActivityCard key={a.key} activity={a} />
          ))}
          {isToday && <StepsCard today={today} steps={metrics?.steps} goal={settings.stepGoal} lastSyncedAt={lastSyncedAt} />}
          {isToday && <WeightCard />}
          <UpNext day={day} />
        </View>
      </Animated.ScrollView>

      <Animated.View pointerEvents="none" style={[s.slimWrap, { paddingTop: insets.top + 10 }, slimStyle]}>
        <SlimBar arcs={arcs} day={day} done={done} total={total} steps={steps} />
      </Animated.View>
      {/* Keeps scrolled content from showing under the transparent status bar. */}
      <View pointerEvents="none" style={[s.statusBar, { height: insets.top }]} />

      {isToday && <ActionPill next={next} restDay={rest} onLog={() => setQuickLog(true)} onWeighIn={() => setWeighIn(true)} />}

      <QuickLogSheet visible={quickLog} onClose={() => setQuickLog(false)} />
      <WeighInSheet visible={weighIn} onClose={() => setWeighIn(false)} />
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

interface CenterProps {
  rest: boolean;
  steps?: number;
  goal: number;
  focus?: Lane;
  focusArc?: { done: number; total: number };
  allDone: boolean;
  done: number;
  total: number;
  next?: AgendaItem;
  isToday: boolean;
}

/** The ring's center: the count and the next item, a focused lane, all done, or the steps on a rest day. */
function RingCenter({ rest, steps, goal, focus, focusArc, allDone, done, total, next, isToday }: CenterProps) {
  const s = useStyles();
  const p = usePalette();
  const when = isToday ? 'done today' : 'done';
  if (rest) {
    return (
      <>
        <T v="labelStrong" color={p.run.onTint}>
          Rest day
        </T>
        <T v="ring" num>
          {steps === undefined ? '0' : thousands(steps)}
        </T>
        <T v="body" tone="secondary" num>{`of ${thousands(goal)} steps`}</T>
      </>
    );
  }
  if (focus && focusArc) {
    return (
      <>
        <T v="labelStrong" color={laneColor(p, focus).onTint}>
          {LANE_NAME[focus]}
        </T>
        <T v="ring" num>{`${focusArc.done} of ${focusArc.total}`}</T>
        <T v="body" tone="secondary">
          {when}
        </T>
      </>
    );
  }
  if (allDone) {
    return (
      <>
        <View style={s.doneBadge}>
          <Icons.check size={22} color={p.onPrimary} strokeWidth={2.8} />
        </View>
        <T v="ringSm">All done</T>
        <T v="body" tone="secondary" num>{`${done} of ${total} ${isToday ? 'today' : 'done'}`}</T>
      </>
    );
  }
  const c = next ? laneColor(p, next.lane) : undefined;
  return (
    <>
      <T v="ring" num>{`${done} of ${total}`}</T>
      <T v="body" tone="secondary">
        {when}
      </T>
      {next && c && (
        <View style={[s.nextPill, { backgroundColor: c.tint }]}>
          <T v="captionStrong" color={c.onTint} num numberOfLines={1}>
            {`Next: ${next.title}, ${next.time ? clockTime(next.time) : formatMinutes(next.estSeconds)}`}
          </T>
        </View>
      )}
    </>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 16, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  settings: { borderWidth: 1, borderColor: p.border, backgroundColor: p.surface },
  below: { gap: 12, marginTop: 18 },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: p.bg },
  slimWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: p.bg, borderBottomWidth: 1, borderBottomColor: p.border },
  doneBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  nextPill: { marginTop: 8, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, maxWidth: 170 },
}));
