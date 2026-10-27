/**
 * The Today day widget (spec §14): a two-ring day ring on the left (lanes inside, steps
 * outside) and a details panel on the right that follows what is tapped on the ring.
 * Fill and dim animate on the UI thread.
 */
import { type AgendaItem, type Lane, type RingArc, type RingHit, type RingLayout, type UnitPrefs, dayRing, formatDistance, formatMinutes, ringHit } from '@fit/core';
import { router } from 'expo-router';
import { type ComponentRef, type Ref, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, Pressable, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G } from 'react-native-svg';
import { syncedLabel } from '@/features/health/state';
import { clockTime, thousands } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, usePalette } from '@/theme';
import { Icons, LANE_ICON } from '@/ui/icons';
import { T } from '@/ui/primitives';
import type { DaySummary } from './daySummary';

const SIZE = 176;
const CX = SIZE / 2;
const STEPS_R = 78;
const DAY_R = 44;
const WIDTH = 14;
/** Touch margin either side of a ring: each ring's touch band is 44 px deep. */
const SLOP = 19;
const LAYOUT: RingLayout = { stepsR: STEPS_R, dayR: DAY_R, width: WIDTH, slop: SLOP };
/** The outer band reaches past the drawing. */
const HIT_SLOP = STEPS_R + WIDTH / 2 + SLOP - CX;
const MOTION_MS = 200;
const DIM = 0.25;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

export const LANE_NAME: Record<Lane, string> = { run: 'Run', workout: 'Workout', stretch: 'Stretch' };

type Selection = { ring: 'steps' } | { ring: 'day'; lane: Lane };

const same = (a: Selection | undefined, b: Selection) => a?.ring === b.ring && (a.ring === 'steps' || (b.ring === 'day' && a.lane === b.lane));

/** One arc: a track in `track`, filled clockwise in `color` by `fill`, dimmed when another part is selected. */
function ArcStroke({ r, start, end, fill, color, track, dim }: { r: number; start: number; end: number; fill: number; color: string; track: string; dim: boolean }) {
  const c = 2 * Math.PI * r;
  const len = (end - start) * c;
  const f = useSharedValue(fill);
  const o = useSharedValue(dim ? DIM : 1);
  useEffect(() => {
    f.value = withTiming(fill, { duration: MOTION_MS });
  }, [fill, f]);
  useEffect(() => {
    o.value = withTiming(dim ? DIM : 1, { duration: MOTION_MS });
  }, [dim, o]);
  const fillProps = useAnimatedProps(() => ({ strokeDasharray: [f.value * len, c] }));
  const groupProps = useAnimatedProps(() => ({ opacity: o.value }));
  const common = { cx: CX, cy: CX, r, fill: 'none', strokeWidth: WIDTH, strokeDashoffset: -start * c, transform: `rotate(-90 ${CX} ${CX})` } as const;
  return (
    <AnimatedG animatedProps={groupProps}>
      <Circle {...common} stroke={track} strokeDasharray={`${len} ${c}`} />
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
  summary: DaySummary;
  items: readonly AgendaItem[];
  stepGoal: number;
  steps?: number;
  lastSyncedAt?: string;
  units: UnitPrefs;
  /** Scrolls the checklist to an item's card. */
  onJump: (key: string) => void;
}

export const DayWidget = memo(function DayWidget({ ref, summary, items, stepGoal, steps, lastSyncedAt, units, onJump }: DayWidgetProps) {
  const s = useStyles();
  const p = usePalette();
  const [sel, setSel] = useState<Selection>();
  const box = useRef<ComponentRef<typeof View>>(null);
  const arcs = dayRing(items);

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

  const pick = (next: Selection | undefined) => {
    haptic.tick();
    setSel((cur) => (!next || same(cur, next) ? undefined : next));
  };
  const onRing = (hit: RingHit | undefined) => pick(!hit || hit.ring === 'center' ? undefined : hit.ring === 'steps' ? { ring: 'steps' } : { ring: 'day', lane: hit.lane });

  const synced = steps !== undefined;
  const met = synced && steps >= stepGoal;
  const stepsLabel = synced ? `Steps, ${thousands(steps)} of ${thousands(stepGoal)}` : 'Steps, not synced';

  return (
    <View ref={box} style={s.card}>
      <Pressable
        accessible={false}
        hitSlop={HIT_SLOP}
        onPress={(e) => onRing(ringHit(e.nativeEvent.locationX - CX, e.nativeEvent.locationY - CX, arcs, LAYOUT))}
        style={{ width: SIZE, height: SIZE }}
      >
        <Svg width={SIZE} height={SIZE} style={StyleFill}>
          <ArcStroke r={STEPS_R} start={0} end={1} fill={synced ? Math.min(1, steps / stepGoal) : 0} color={met ? p.success : p.primary} track={p.ringTrack} dim={sel !== undefined && sel.ring !== 'steps'} />
          {arcs.length === 0 ? (
            <ArcStroke r={DAY_R} start={0} end={1} fill={0} color={p.ringTrack} track={p.ringTrack} dim={sel !== undefined} />
          ) : (
            arcs.map((a) => <ArcStroke key={a.lane} r={DAY_R} start={a.start} end={a.end} fill={a.fill} color={laneColor(p, a.lane).color} track={laneColor(p, a.lane).pending} dim={sel !== undefined && !(sel.ring === 'day' && sel.lane === a.lane)} />)
          )}
        </Svg>
        <View style={[StyleFill, s.center]} pointerEvents="none">
          <T v="statSm" num>
            {summary.total > 0 ? `${summary.done} of ${summary.total}` : synced ? thousands(steps) : '-'}
          </T>
          <T v="tiny" tone="secondary">
            {summary.total > 0 ? 'done' : 'steps'}
          </T>
        </View>
        {/* One button per part for screen readers; a touch on one selects the same part. */}
        <Pressable accessibilityRole="button" accessibilityLabel={stepsLabel} accessibilityState={{ selected: sel?.ring === 'steps' }} onPress={() => pick({ ring: 'steps' })} style={[s.a11y, midpoint(STEPS_R, 0, 0)]} />
        {arcs.map((a: RingArc) => (
          <Pressable
            key={a.lane}
            accessibilityRole="button"
            accessibilityLabel={`${LANE_NAME[a.lane]}, ${a.done} of ${a.total} done`}
            accessibilityState={{ selected: sel?.ring === 'day' && sel.lane === a.lane }}
            onPress={() => pick({ ring: 'day', lane: a.lane })}
            style={[s.a11y, midpoint(DAY_R, a.start, a.end)]}
          />
        ))}
      </Pressable>

      <View style={s.panel}>
        {!sel ? (
          <Overview summary={summary} />
        ) : sel.ring === 'steps' ? (
          <Pressable accessibilityRole="button" accessibilityHint="Opens activity stats" onPress={() => router.navigate('/stats')} style={{ gap: 6 }}>
            <T v="headline" num>
              {synced ? `${thousands(steps)} steps` : 'Steps'}
            </T>
            <T v="label" tone="secondary" num>
              {synced ? `of ${thousands(stepGoal)}, ${met ? 'goal met' : `${thousands(stepGoal - steps)} to go`}` : 'Not synced yet'}
            </T>
            {lastSyncedAt && (
              <T v="caption" tone="tertiary" num>
                {`Synced ${syncedLabel(lastSyncedAt)}`}
              </T>
            )}
          </Pressable>
        ) : (
          <LanePanel lane={sel.lane} items={items.filter((i) => i.lane === sel.lane)} units={units} onJump={onJump} />
        )}
      </View>
    </View>
  );
});

const StyleFill = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

function Overview({ summary }: { summary: DaySummary }) {
  const s = useStyles();
  const p = usePalette();
  const LineIcon = summary.line ? LANE_ICON[summary.line.lane] : undefined;
  const SubIcon = summary.sub?.icon === 'clock' ? Icons.clock : Icons.calendar;
  return (
    <>
      <T v="headline" numberOfLines={2}>
        {summary.headline}
      </T>
      {summary.line && LineIcon && (
        <View style={s.line}>
          <LineIcon size={14} color={laneColor(p, summary.line.lane).color} />
          <T v="label" style={{ flex: 1 }} numberOfLines={3}>
            {summary.line.text}
          </T>
        </View>
      )}
      {summary.sub && (
        <View style={s.line}>
          <SubIcon size={14} color={p.textTertiary} />
          <T v="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={2}>
            {summary.sub.text}
          </T>
        </View>
      )}
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
  card: { backgroundColor: p.surface, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 14, alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  a11y: { position: 'absolute', width: 44, height: 44 },
  panel: { flex: 1, minWidth: 0, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  slim: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: p.surface },
}));
