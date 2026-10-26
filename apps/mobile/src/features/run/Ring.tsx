/**
 * The 270° in-run ring (design.md "In-run gauge"). Arcs are static SVG; the marker and the
 * progress arc move on the UI thread through Reanimated animated props, so a once-a-second
 * value change never re-renders the screen.
 */
import { memo, useEffect } from 'react';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

const SIZE = 300;
const R = 120;
const CX = SIZE / 2;
const C = 2 * Math.PI * R;
/** The ring spans 270°, starting at the lower left (135° from 3 o'clock). */
const SPAN = 0.75;
const START_DEG = 135;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface Arc {
  /** 0..1 along the ring. */
  from: number;
  to: number;
  color: string;
  width: number;
}

/** A static arc segment, `gapPx` trimmed off the end so neighbors read as separate. */
function ArcPath({ arc, gapPx = 0 }: { arc: Arc; gapPx?: number }) {
  const len = Math.max(0, (arc.to - arc.from) * SPAN * C - gapPx);
  return (
    <Circle
      cx={CX}
      cy={CX}
      r={R}
      fill="none"
      stroke={arc.color}
      strokeWidth={arc.width}
      strokeDasharray={`${len} ${C}`}
      strokeDashoffset={-arc.from * SPAN * C}
      transform={`rotate(${START_DEG} ${CX} ${CX})`}
    />
  );
}

interface RingProps {
  size: number;
  arcs: readonly Arc[];
  /** Gap between arcs in px of the 300 grid (zone rings). */
  gapPx?: number;
  /** 0..1 position of the marker dot; undefined hides it. */
  marker?: number;
  markerColor: string;
  /** Halo behind the marker, the screen background. */
  bg: string;
  /** 0..1 filled progress drawn over the track (timer ring). */
  progress?: number;
  progressColor?: string;
}

export const Ring = memo(function Ring({ size, arcs, gapPx, marker, markerColor, bg, progress, progressColor }: RingProps) {
  const m = useSharedValue(marker ?? 0);
  const prog = useSharedValue(progress ?? 0);
  useEffect(() => {
    if (marker !== undefined) m.value = withTiming(marker, { duration: 600 });
  }, [marker, m]);
  useEffect(() => {
    // Progress moves linearly over the next second, so the arc fills continuously.
    if (progress !== undefined) prog.value = withTiming(progress, { duration: 1000 });
  }, [progress, prog]);

  const dot = useAnimatedProps(() => {
    const a = ((START_DEG + m.value * SPAN * 360) * Math.PI) / 180;
    return { cx: CX + R * Math.cos(a), cy: CX + R * Math.sin(a) };
  });
  const halo = useAnimatedProps(() => {
    const a = ((START_DEG + m.value * SPAN * 360) * Math.PI) / 180;
    return { cx: CX + R * Math.cos(a), cy: CX + R * Math.sin(a) };
  });
  const fill = useAnimatedProps(() => ({ strokeDasharray: [prog.value * SPAN * C, C] }));

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${SIZE} ${SIZE}`}>
      {arcs.map((a, i) => (
        <ArcPath key={i} arc={a} gapPx={gapPx} />
      ))}
      {progress !== undefined && progressColor && (
        <AnimatedCircle
          cx={CX}
          cy={CX}
          r={R}
          fill="none"
          stroke={progressColor}
          strokeWidth={14}
          strokeLinecap="round"
          transform={`rotate(${START_DEG} ${CX} ${CX})`}
          animatedProps={fill}
        />
      )}
      {marker !== undefined && (
        <>
          <AnimatedCircle r={11} fill={bg} animatedProps={halo} />
          <AnimatedCircle r={7} fill={markerColor} animatedProps={dot} />
        </>
      )}
    </Svg>
  );
});
