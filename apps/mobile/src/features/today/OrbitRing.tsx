/**
 * The Orbit day ring (spec §14 Today: Orbit layout, design canvas A2). One arc per lane
 * today, each filled by a gradient from the lane's light to deep tone, with a soft glow
 * under it, a knob at the end of the fill, a dotted bezel outside and a disc inside. On a
 * rest day it is the steps ring instead. Tapping an arc focuses its lane: the others and
 * the bezel dim and the arc thickens. Drawn in a 300 box and scaled to `size`.
 */
import { type Lane, type RingArc, type RingHit, ringHit } from '@fit/core';
import { type ReactNode, useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { laneColor, motion, usePalette } from '@/theme';
import { LANE_NAME } from './lanes';

const BOX = 300;
const C = BOX / 2;
const R = 120;
const WIDTH = 26;
const FOCUS_WIDTH = 34;
const BEZEL_R = 145;
const DISC_R = 94;
const INDICATOR_R = 141;
const KNOB_R = 10;
/** Touch margin either side of the ring, in box units. */
const SLOP = 14;
const DIM = 0.22;

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** A point on a circle at `f` of the way round, clockwise from 12 o'clock. */
function pt(f: number, r: number): [number, number] {
  const a = f * 2 * Math.PI;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

/** An arc from `a0` to `a1` (fractions of the circle). A whole circle is drawn as two halves. */
function arcPath(a0: number, a1: number, r: number): string {
  if (a1 - a0 >= 0.9999) {
    const [x0, y0] = pt(a0, r);
    const [xh, yh] = pt(a0 + 0.5, r);
    return `M ${x0} ${y0} A ${r} ${r} 0 1 1 ${xh} ${yh} A ${r} ${r} 0 1 1 ${x0} ${y0}`;
  }
  const [x0, y0] = pt(a0, r);
  const [x1, y1] = pt(a1, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** One segment of the ring: its track, the filled part and what goes with it. */
export interface OrbitArc {
  key: Lane | 'steps';
  start: number;
  end: number;
  /** 0 to 1. */
  fill: number;
  /** Solid color for the glow and the knob border. */
  color: string;
  track: string;
  /** Track while focused. */
  focusTrack: string;
  grad: readonly [string, string];
}

export function laneArcs(arcs: readonly RingArc[], p: ReturnType<typeof usePalette>): OrbitArc[] {
  return arcs.map((a) => {
    const c = laneColor(p, a.lane);
    return { key: a.lane, start: a.start, end: a.end, fill: a.fill, color: c.color, track: c.tint, focusTrack: c.pending, grad: p.grad[a.lane] };
  });
}

function Arc({ arc, dim, focused, strong }: { arc: OrbitArc; dim: boolean; focused: boolean; strong: boolean }) {
  const p = usePalette();
  const o = useSharedValue(dim ? DIM : 1);
  const w = useSharedValue(focused ? FOCUS_WIDTH : WIDTH);
  useEffect(() => {
    o.value = withTiming(dim ? DIM : 1, { duration: motion.base });
  }, [dim, o]);
  useEffect(() => {
    w.value = withTiming(focused ? FOCUS_WIDTH : WIDTH, { duration: motion.base });
  }, [focused, w]);
  const groupProps = useAnimatedProps(() => ({ opacity: o.value }));
  const widthProps = useAnimatedProps(() => ({ strokeWidth: w.value }));

  const end = arc.start + arc.fill * (arc.end - arc.start);
  const filled = arc.fill > 0.001;
  const fillPath = arcPath(arc.start, end, R);
  // The gradient runs from where the fill starts to where it ends. Past half a turn the ends
  // come back together, so it runs across the ring instead.
  const [gx1, gy1] = pt(arc.start, R);
  const [gx2, gy2] = end - arc.start > 0.5 ? pt(arc.start + 0.5, R) : pt(end, R);
  const [kx, ky] = pt(end, R);
  const id = `orbit-${arc.key}`;
  return (
    <AnimatedG animatedProps={groupProps}>
      <Defs>
        <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={gx1} y1={gy1} x2={gx2} y2={gy2}>
          <Stop offset="0" stopColor={arc.grad[0]} />
          <Stop offset="1" stopColor={arc.grad[1]} />
        </LinearGradient>
      </Defs>
      <AnimatedPath d={arcPath(arc.start, arc.end, R)} stroke={focused ? arc.focusTrack : arc.track} fill="none" animatedProps={widthProps} />
      {filled && (
        <>
          {/* A blur filter is not available, so the glow is two wide, faint strokes under the fill. */}
          <Path d={fillPath} stroke={arc.color} strokeOpacity={strong ? 0.14 : 0.1} strokeWidth={WIDTH + (strong ? 24 : 18)} fill="none" />
          <Path d={fillPath} stroke={arc.color} strokeOpacity={strong ? 0.2 : 0.14} strokeWidth={WIDTH + (strong ? 12 : 8)} fill="none" />
          <AnimatedPath d={fillPath} stroke={`url(#${id})`} fill="none" animatedProps={widthProps} />
          <Circle cx={kx} cy={ky} r={KNOB_R} fill={p.surface} stroke={arc.grad[1]} strokeWidth={4} />
          {arc.fill >= 0.9999 && <Path d={`M ${kx - 4.4} ${ky} l 3 3 l 5.5 -6`} stroke={arc.grad[1]} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />}
        </>
      )}
      {focused && <Path d={arcPath(arc.start + 0.006, arc.end - 0.006, INDICATOR_R)} stroke={arc.color} strokeWidth={3} strokeLinecap="round" fill="none" />}
    </AnimatedG>
  );
}

/** Where an arc's middle sits on screen, for its screen reader button. */
function midpoint(arc: OrbitArc, scale: number) {
  const [x, y] = pt((arc.start + arc.end) / 2, R);
  return { left: x * scale - 22, top: y * scale - 22 };
}

interface OrbitRingProps {
  size: number;
  arcs: readonly OrbitArc[];
  /** Lane arcs for hit testing; empty for the steps ring, which takes no lane taps. */
  lanes: readonly RingArc[];
  focus?: Lane;
  /** Stronger glow once everything is done. */
  strong?: boolean;
  /** A lane, the center, or undefined for a touch off the ring. */
  onHit?: (hit: RingHit | undefined) => void;
  label: string;
  children: ReactNode;
}

export function OrbitRing({ size, arcs, lanes, focus, strong = false, onHit, label, children }: OrbitRingProps) {
  const p = usePalette();
  const scale = size / BOX;
  const press = (x: number, y: number) => {
    const dx = x / scale - C;
    const dy = y / scale - C;
    // ringHit has no outer edge for a lone day ring, so a touch past the band is "outside" here.
    onHit?.(Math.hypot(dx, dy) > R + FOCUS_WIDTH / 2 + SLOP ? undefined : ringHit(dx, dy, lanes, { stepsR: Number.POSITIVE_INFINITY, dayR: R, width: WIDTH, slop: SLOP }));
  };
  const bezelO = useSharedValue(focus ? 0.4 : 1);
  useEffect(() => {
    bezelO.value = withTiming(focus ? 0.4 : 1, { duration: motion.base });
  }, [focus, bezelO]);
  const bezelProps = useAnimatedProps(() => ({ opacity: bezelO.value }));
  // The bezel: short ticks every 15.2 units round the outside.
  const bezelC = 2 * Math.PI * BEZEL_R;

  return (
    <Pressable accessible={false} disabled={!onHit} onPress={(e) => press(e.nativeEvent.locationX, e.nativeEvent.locationY)} style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`} accessibilityRole="image" accessibilityLabel={label}>
        <AnimatedG animatedProps={bezelProps}>
          <Circle cx={C} cy={C} r={BEZEL_R} fill="none" stroke={p.dashed} strokeWidth={6} strokeDasharray={`1.2 ${bezelC / 60 - 1.2}`} />
        </AnimatedG>
        <Circle cx={C} cy={C} r={DISC_R} fill={p.surface} />
        {/* The focused arc draws last so its thicker stroke sits on top of its neighbors. */}
        {[...arcs]
          .sort((a, b) => Number(a.key === focus) - Number(b.key === focus))
          .map((a) => (
            <Arc key={a.key} arc={a} dim={focus !== undefined && focus !== a.key} focused={focus === a.key} strong={strong} />
          ))}
      </Svg>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
      {onHit &&
        arcs.map((a) =>
          a.key === 'steps' ? null : (
            <Pressable
              key={a.key}
              accessibilityRole="button"
              accessibilityLabel={LANE_NAME[a.key]}
              accessibilityHint={focus === a.key ? 'Back to the day' : 'Shows this lane'}
              accessibilityState={{ selected: focus === a.key }}
              onPress={() => onHit({ ring: 'day', lane: a.key as Lane })}
              style={[{ position: 'absolute', width: 44, height: 44 }, midpoint(a, scale)]}
            />
          ),
        )}
    </Pressable>
  );
}

/** A small, flat copy of the ring for the slim bar and the week strip: lane segments filled as done. */
export function MiniOrbit({ arcs, size, width, track }: { arcs: readonly OrbitArc[]; size: number; width: number; track: string }) {
  const r = (size - width) / 2;
  const m = size / 2;
  const at = (f: number): [number, number] => {
    const a = f * 2 * Math.PI;
    return [m + r * Math.sin(a), m - r * Math.cos(a)];
  };
  const path = (a0: number, a1: number) => {
    if (a1 - a0 >= 0.9999) return `M ${m} ${m - r} A ${r} ${r} 0 1 1 ${m} ${m + r} A ${r} ${r} 0 1 1 ${m} ${m - r}`;
    const [x0, y0] = at(a0);
    const [x1, y1] = at(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  return (
    <Svg width={size} height={size}>
      <Circle cx={m} cy={m} r={r} fill="none" stroke={track} strokeWidth={width} />
      {arcs.map((a) => (
        <G key={a.key}>
          <Path d={path(a.start, a.end)} stroke={a.track} strokeWidth={width} fill="none" />
          {a.fill > 0.001 && <Path d={path(a.start, a.start + a.fill * (a.end - a.start))} stroke={a.color} strokeWidth={width} fill="none" />}
        </G>
      ))}
    </Svg>
  );
}
