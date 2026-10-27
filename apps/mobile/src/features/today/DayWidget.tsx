/**
 * The Today day widget (spec §14): the day ring on the left, one arc per lane, and this
 * week as small day rings on the right. Tapping an arc shows that lane's items in place of
 * the week. Fill and dim animate on the UI thread. Steps have their own card below.
 */
import { type AgendaItem, type IsoDate, type Lane, type RingArc, type RingHit, type RingLayout, type UnitPrefs, addDays, dayRing, formatDistance, formatMinutes, ringHit, startOfWeek, weekdayOf } from '@fit/core';
import { type ComponentRef, type Ref, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';
import { useShallow } from 'zustand/react/shallow';
import { repo } from '@/data';
import { actions, useFit, useSettings } from '@/data/store';
import { useHealth } from '@/features/health/state';
import { clockTime, thousands, weekdayLetter, weekdayLong } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, usePalette } from '@/theme';
import { T } from '@/ui/primitives';
import type { DaySummary } from './daySummary';

const SIZE = 140;
const CX = SIZE / 2;
const DAY_R = 58;
const WIDTH = 16;
/** Touch margin either side of the ring: a band 44 px deep. */
const SLOP = 14;
/** The day ring is the only ring: an infinite steps radius keeps every ringHit on it. */
const LAYOUT: RingLayout = { stepsR: Number.POSITIVE_INFINITY, dayR: DAY_R, width: WIDTH, slop: SLOP };
/** The touch band reaches past the drawing. */
const HIT_SLOP = DAY_R + WIDTH / 2 + SLOP - CX;
/** Space between lane arcs, as a fraction of the circle: about 2 px on the day ring. */
const LANE_GAP = 0;
const MOTION_MS = 200;
const DIM = 0.25;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

export const LANE_NAME: Record<Lane, string> = { run: 'Run', workout: 'Workout', stretch: 'Stretch' };

/**
 * One arc: a track in `track`, filled clockwise in `color` by `fill`, dimmed when another
 * lane is selected. Ends are round; a segment is trimmed by half the stroke at each end so
 * the caps stay inside its share and the gaps between lanes stay clear.
 */
function ArcStroke({ r, start, end, fill, color, track, dim }: { r: number; start: number; end: number; fill: number; color: string; track: string; dim: boolean }) {
  const c = 2 * Math.PI * r;
  const full = end - start >= 1;
  const trim = 0;
  const len = (end - start) * c - 2 * trim;
  const f = useSharedValue(fill);
  const o = useSharedValue(dim ? DIM : 1);
  useEffect(() => {
    f.value = withTiming(fill, { duration: MOTION_MS });
  }, [fill, f]);
  useEffect(() => {
    o.value = withTiming(dim ? DIM : 1, { duration: MOTION_MS });
  }, [dim, o]);
  // A zero-length dash with round caps would still draw a dot, so an empty fill hides.
  const fillProps = useAnimatedProps(() => ({ strokeDasharray: [f.value * len, c], strokeOpacity: f.value > 0.001 ? 1 : 0 }));
  const groupProps = useAnimatedProps(() => ({ opacity: o.value }));
  const common = { cx: CX, cy: CX, r, fill: 'none', strokeWidth: WIDTH, strokeLinecap: 'butt', strokeDashoffset: -(start * c + trim), transform: `rotate(-90 ${CX} ${CX})` } as const;
  return (
    <AnimatedG animatedProps={groupProps}>
      {full ? <Circle cx={CX} cy={CX} r={r} fill="none" strokeWidth={WIDTH} stroke={track} /> : <Circle {...common} stroke={track} strokeDasharray={`${len} ${c}`} />}
      <AnimatedCircle {...common} stroke={color} animatedProps={fillProps} />
    </AnimatedG>
  );
}

/** Where an arc's middle sits, for its screen reader button. */
function midpoint(r: number, start: number, end: number) {
  const a = ((start + end) / 2) * 2 * Math.PI;
  return { left: CX + r * Math.sin(a) - 22, top: CX - r * Math.cos(a) - 22 };
}

export interface DayWidgetHandle {
  /** A touch anywhere on the screen; one outside the widget clears the selection. */
  touch: (pageX: number, pageY: number) => void;
}

interface DayWidgetProps {
  ref?: Ref<DayWidgetHandle>;
  today: IsoDate;
  summary: DaySummary;
  items: readonly AgendaItem[];
  units: UnitPrefs;
  /** Scrolls the checklist to an item's card. */
  onJump: (key: string) => void;
  /** Opens a day of the week. */
  onDay: (date: IsoDate) => void;
}

export const DayWidget = memo(function DayWidget({ ref, today, summary, items, units, onJump, onDay }: DayWidgetProps) {
  const s = useStyles();
  const p = usePalette();
  const [sel, setSel] = useState<Lane>();
  const box = useRef<ComponentRef<typeof View>>(null);
  const arcs = dayRing(items, LANE_GAP);

  useImperativeHandle(ref, () => ({
    touch: (x, y) => {
      if (!sel) return;
      box.current?.measureInWindow((bx, by, w, h) => {
        if (x < bx || x > bx + w || y < by || y > by + h) setSel(undefined);
      });
    },
  }));

  // Coming back to the app starts from the plain view.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setSel(undefined));
    return () => sub.remove();
  }, []);

  const pick = (lane: Lane | undefined) => {
    haptic.tick();
    setSel((cur) => (!lane || cur === lane ? undefined : lane));
  };
  const onRing = (hit: RingHit | undefined) => pick(hit?.ring === 'day' ? hit.lane : undefined);

  return (
    <View ref={box} style={s.card}>
      <Pressable
        accessible={false}
        hitSlop={HIT_SLOP}
        onPress={(e) => onRing(ringHit(e.nativeEvent.locationX - CX, e.nativeEvent.locationY - CX, arcs, LAYOUT))}
        style={{ width: SIZE, height: SIZE }}
      >
        <Svg width={SIZE} height={SIZE} style={StyleFill}>
          {arcs.length === 0 ? (
            <ArcStroke r={DAY_R} start={0} end={1} fill={0} color={p.ringTrack} track={p.ringTrack} dim={false} />
          ) : (
            arcs.map((a) => <ArcStroke key={a.lane} r={DAY_R} start={a.start} end={a.end} fill={a.fill} color={laneColor(p, a.lane).color} track={laneColor(p, a.lane).pending} dim={sel !== undefined && sel !== a.lane} />)
          )}
        </Svg>
        <View style={[StyleFill, s.center]} pointerEvents="none">
          <T v="statSm" num>
            {summary.total > 0 ? `${summary.done} of ${summary.total}` : 'Rest'}
          </T>
          <T v="tiny" tone="secondary">
            {summary.total > 0 ? 'done' : 'day'}
          </T>
        </View>
        {/* One button per arc for screen readers; a touch on one selects the same arc. */}
        {arcs.map((a: RingArc) => (
          <Pressable
            key={a.lane}
            accessibilityRole="button"
            accessibilityLabel={`${LANE_NAME[a.lane]}, ${a.done} of ${a.total} done`}
            accessibilityState={{ selected: sel === a.lane }}
            onPress={() => pick(a.lane)}
            style={[s.a11y, midpoint(DAY_R, a.start, a.end)]}
          />
        ))}
      </Pressable>

      <View style={s.panel}>
        {sel ? <LanePanel lane={sel} items={items.filter((i) => i.lane === sel)} units={units} onJump={onJump} /> : <WeekPanel today={today} units={units} onDay={onDay} />}
      </View>
    </View>
  );
});

const StyleFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

const MINI = 26;
const MINI_R = 10;
const MINI_W = 4;

/** A day as a small day ring: one segment per lane, no gaps, filled as its items are done. A dot in the middle marks the step goal met. */
function MiniRing({ items, stepGoal }: { items: readonly AgendaItem[]; stepGoal: boolean }) {
  const p = usePalette();
  const c = 2 * Math.PI * MINI_R;
  const m = MINI / 2;
  const common = { cx: m, cy: m, r: MINI_R, fill: 'none', strokeWidth: MINI_W, transform: `rotate(-90 ${m} ${m})` } as const;
  return (
    <Svg width={MINI} height={MINI}>
      <Circle {...common} stroke={p.ringTrack} />
      {stepGoal && <Circle cx={m} cy={m} r={3.5} fill={p.steps} />}
      {dayRing(items, 0).map((a) => {
        const len = (a.end - a.start) * c;
        const lc = laneColor(p, a.lane);
        return (
          <G key={a.lane}>
            <Circle {...common} stroke={lc.pending} strokeDasharray={`${len} ${c}`} strokeDashoffset={-a.start * c} />
            {a.fill > 0 && <Circle {...common} stroke={lc.color} strokeDasharray={`${a.fill * len} ${c}`} strokeDashoffset={-a.start * c} />}
          </G>
        );
      })}
    </Svg>
  );
}

/** Steps per day for the week from `start`. Takes the sync time so the memo re-reads after a sync. */
function stepsOn(start: IsoDate, _syncedAt: string | undefined): Map<IsoDate, number> {
  return new Map(repo.dailyMetricsRange(start, addDays(start, 6)).map((m) => [m.date, m.steps ?? 0]));
}

/** Monday to Sunday of this week as small day rings, with what is done so far. Tapping a day opens it. */
function WeekPanel({ today, units, onDay }: { today: IsoDate; units: UnitPrefs; onDay: (d: IsoDate) => void }) {
  const s = useStyles();
  const start = startOfWeek(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  useEffect(() => actions.ensureRange(start, addDays(start, 6)), [start]);
  const week = useFit(useShallow((st) => days.flatMap((d) => (st.byDate[d] ?? []).map((k) => st.items[k]!))));
  const goal = useSettings().stepGoal;
  const syncedAt = useHealth((h) => h.lastSyncedAt);
  const steps = useMemo(() => stepsOn(start, syncedAt), [start, syncedAt]);
  const done = week.filter((i) => i.status === 'done');
  const meters = done.reduce((t, i) => t + (i.lane === 'run' ? (i.details?.distanceM ?? 0) : 0), 0);
  return (
    <>
      <View>
        <T v="label" tone="secondary">
          This week
        </T>
        <T v="labelStrong" num numberOfLines={1}>
          {week.length === 0 ? 'Nothing planned' : `${done.length} of ${week.length} done${meters > 0 ? `, ${formatDistance(meters, units.distance, 1)}` : ''}`}
        </T>
      </View>
      <View style={s.week}>
        {days.map((d) => {
          const items = week.filter((i) => i.date === d);
          const isToday = d === today;
          const met = (steps.get(d) ?? 0) >= goal;
          return (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityLabel={`${weekdayLong(weekdayOf(d))}, ${items.length === 0 ? 'rest day' : `${items.filter((i) => i.status === 'done').length} of ${items.length} done`}${met ? ', step goal met' : ''}`}
              hitSlop={4}
              onPress={() => {
                haptic.tick();
                onDay(d);
              }}
              style={({ pressed }) => [s.weekDay, pressed && { opacity: 0.6 }]}
            >
              <T v="micro" tone={isToday ? undefined : 'tertiary'}>
                {weekdayLetter(weekdayOf(d))}
              </T>
              <MiniRing items={items} stepGoal={met} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

/** Time for a pending item, the result once done, or "Skipped". */
function itemDetail(i: AgendaItem, units: UnitPrefs): string {
  if (i.status === 'skipped') return 'Skipped';
  if (i.status === 'done') {
    const d = i.details;
    const parts = [d?.distanceM ? formatDistance(d.distanceM, units.distance, 2) : undefined, d?.minutes ? formatMinutes(d.minutes * 60) : undefined].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'Done';
  }
  return i.time ? clockTime(i.time) : formatMinutes(i.estSeconds);
}

function LanePanel({ lane, items, units, onJump }: { lane: Lane; items: AgendaItem[]; units: UnitPrefs; onJump: (key: string) => void }) {
  const p = usePalette();
  const done = items.filter((i) => i.status === 'done').length;
  return (
    <>
      <View>
        <T v="headline" color={laneColor(p, lane).onTint}>
          {LANE_NAME[lane]}
        </T>
        <T v="label" tone="secondary" num>{`${done} of ${items.length} done`}</T>
      </View>
      {items.map((i) => (
        <Pressable key={i.key} accessibilityRole="button" accessibilityHint="Scrolls to its card" onPress={() => onJump(i.key)} style={({ pressed }) => [{ paddingVertical: 2 }, pressed && { opacity: 0.6 }]}>
          <T v="labelStrong" numberOfLines={1}>
            {i.title}
          </T>
          <T v="caption" tone="secondary" num numberOfLines={1}>
            {itemDetail(i, units)}
          </T>
        </Pressable>
      ))}
    </>
  );
}

/** One segment per item today, colored by lane, filled when done. */
export const DayStrip = memo(function DayStrip({ segments, height = 8 }: { segments: DaySummary['segments']; height?: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {segments.map((seg, i) => {
        const c = laneColor(p, seg.lane);
        const bg = seg.status === 'done' ? (seg.lane === 'stretch' ? p.success : c.color) : seg.status === 'skipped' ? p.ringTrack : c.pending;
        return <View key={i} style={{ flex: 1, height, borderRadius: height / 2, backgroundColor: bg }} />;
      })}
    </View>
  );
});

/** What the widget shrinks to while the checklist scrolls. */
export const SlimBar = memo(function SlimBar({ summary, steps }: { summary: DaySummary; steps?: number }) {
  const s = useStyles();
  return (
    <View style={s.slim}>
      <T v="labelStrong" numberOfLines={1}>
        {summary.total === 0 ? 'Rest day' : `${summary.done} of ${summary.total} done`}
      </T>
      <View style={{ flex: 1 }}>{summary.segments.length > 0 && <DayStrip segments={summary.segments} height={6} />}</View>
      <T v="caption" tone="secondary" num>
        {steps === undefined ? 'Steps not synced' : `${thousands(steps)} steps`}
      </T>
    </View>
  );
});

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 16, alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  a11y: { position: 'absolute', width: 44, height: 44 },
  panel: { flex: 1, minWidth: 0, gap: 8 },
  week: { flexDirection: 'row', justifyContent: 'space-between' },
  weekDay: { alignItems: 'center', gap: 4, minHeight: 44, justifyContent: 'center' },
  slim: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: p.surface },
}));
