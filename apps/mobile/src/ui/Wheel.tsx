/**
 * Wheel picker: a snapping list with the selected row under a highlight band. Scrolling
 * runs natively; a UI-thread scroll handler ticks a haptic per row and the value commits
 * when the wheel settles, so React renders once per pick, not per frame.
 */
import { memo, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic } from '@/lib/haptics';
import { usePalette } from '@/theme';
import { T } from './primitives';

const ROW = 40;
const VISIBLE = 5;

interface WheelProps {
  values: readonly number[];
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  /** Screen reader name, such as "Minutes". */
  label: string;
  width?: number;
}

export const Wheel = memo(function Wheel({ values, value, onChange, format = String, label, width = 64 }: WheelProps) {
  const p = usePalette();
  const ref = useRef<Animated.ScrollView>(null);
  const start = Math.max(0, values.indexOf(value));
  const shown = useSharedValue(start);
  const committed = useRef(start);
  // The scroll handler lives on the UI thread; it reaches the latest props through refs.
  const latest = useRef({ values, onChange });
  useEffect(() => {
    latest.current = { values, onChange };
  });

  const commit = (y: number) => {
    const { values: vs, onChange: change } = latest.current;
    const i = Math.min(vs.length - 1, Math.max(0, Math.round(y / ROW)));
    if (i === committed.current) return;
    committed.current = i;
    change(vs[i]!);
  };
  const tick = () => haptic.tick();

  // A value set from outside (another control, a reset) moves the wheel to it.
  useEffect(() => {
    const i = values.indexOf(value);
    if (i < 0 || i === committed.current) return;
    committed.current = i;
    ref.current?.scrollTo({ y: i * ROW, animated: true });
  }, [value, values]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      const i = Math.round(e.contentOffset.y / ROW);
      if (i !== shown.value) {
        shown.value = i;
        scheduleOnRN(tick);
      }
    },
    onMomentumEnd: (e) => {
      scheduleOnRN(commit, e.contentOffset.y);
    },
    onEndDrag: (e) => {
      // A slow drag that stops on a row has no momentum phase.
      if (Math.abs(e.velocity?.y ?? 0) < 0.05) scheduleOnRN(commit, e.contentOffset.y);
    },
  });

  const stepBy = (d: number) => {
    const i = Math.min(values.length - 1, Math.max(0, committed.current + d));
    ref.current?.scrollTo({ y: i * ROW, animated: true });
    commit(i * ROW);
  };

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(values[committed.current] ?? value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => stepBy(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      style={{ width, height: ROW * VISIBLE }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: ROW * 2, height: ROW, borderRadius: 10, backgroundColor: p.inset }} />
      <Animated.ScrollView
        ref={ref}
        onScroll={onScroll}
        scrollEventThrottle={16}
        snapToInterval={ROW}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        contentOffset={{ x: 0, y: start * ROW }}
        contentContainerStyle={{ paddingVertical: ROW * 2 }}
        nestedScrollEnabled
      >
        {values.map((v) => (
          <View key={v} style={{ height: ROW, alignItems: 'center', justifyContent: 'center' }}>
            <T v="headline" num>
              {format(v)}
            </T>
          </View>
        ))}
      </Animated.ScrollView>
    </View>
  );
});

export const range = (from: number, to: number, step = 1): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
};

const SECONDS = range(0, 59);
const two = (n: number) => String(n).padStart(2, '0');

/** Minutes and seconds wheels, for goal and race times. */
export function TimeWheel({ seconds, onChange, label, minMinutes = 0, maxMinutes = 179 }: { seconds: number; onChange: (s: number) => void; label: string; minMinutes?: number; maxMinutes?: number }) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const minutes = useMemo(() => range(minMinutes, maxMinutes), [minMinutes, maxMinutes]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <Wheel label={`${label}, minutes`} values={minutes} value={m} onChange={(v) => onChange(v * 60 + s)} />
      <T v="headline">:</T>
      <Wheel label={`${label}, seconds`} values={SECONDS} value={s} format={two} onChange={(v) => onChange(m * 60 + v)} />
    </View>
  );
}
