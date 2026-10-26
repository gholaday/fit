/**
 * One card in the builder list. Drag the grip to reorder: the card follows the finger and
 * its neighbors slide out of the way, all on the UI thread; the new order is committed on
 * release. Swipe left to delete. Positions come from each card's onLayout.
 */
import { type ReactNode, type RefObject, useRef } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic } from '@/lib/haptics';
import { motion, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';

export const CARD_GAP = 10;
const DELETE_AT = -110;

export interface DragState {
  tops: SharedValue<number[]>;
  heights: SharedValue<number[]>;
  /** Index being dragged, -1 when none, and where it would land. */
  from: SharedValue<number>;
  to: SharedValue<number>;
  dy: SharedValue<number>;
  /** Layouts on the JS side. Every card writes here and publishes whole arrays, since a
   *  shared value read on the JS thread can be stale while several cards lay out at once. */
  layout: RefObject<{ tops: number[]; heights: number[] }>;
}

export function useDragState(): DragState {
  // One hook per statement: hooks inside a returned object literal can be memoized away.
  const tops = useSharedValue<number[]>([]);
  const heights = useSharedValue<number[]>([]);
  const from = useSharedValue(-1);
  const to = useSharedValue(-1);
  const dy = useSharedValue(0);
  const layout = useRef<{ tops: number[]; heights: number[] }>({ tops: [], heights: [] });
  return { tops, heights, from, to, dy, layout };
}

export function DragCard({ index, drag, onMove, onDelete, label, children }: { index: number; drag: DragState; onMove: (from: number, to: number) => void; onDelete: () => void; label: string; children: ReactNode }) {
  const p = usePalette();
  const tx = useSharedValue(0);
  const { tops, heights, from, to, dy } = drag;

  // Active on touch-down: the grip is only for dragging, and the list scrolls elsewhere.
  const grip = usePanGesture({
    minDistance: 0,
    onActivate: () => {
      'worklet';
      from.value = index;
      to.value = index;
      dy.value = 0;
      scheduleOnRN(haptic.tick);
    },
    onUpdate: (e) => {
      'worklet';
      if (from.value !== index) return;
      dy.value = e.translationY;
      const t = tops.value;
      const h = heights.value;
      const center = (t[index] ?? 0) + (h[index] ?? 0) / 2 + e.translationY;
      let next = index;
      for (let j = index - 1; j >= 0; j--) if (center < (t[j] ?? 0) + (h[j] ?? 0) / 2) next = j;
      for (let j = index + 1; j < t.length; j++) if (center > (t[j] ?? 0) + (h[j] ?? 0) / 2) next = j;
      if (next !== to.value) {
        to.value = next;
        scheduleOnRN(haptic.tick);
      }
    },
    onFinalize: () => {
      'worklet';
      if (from.value !== index) return;
      const f = from.value;
      const t = to.value;
      from.value = -1;
      to.value = -1;
      dy.value = 0;
      if (t >= 0 && t !== f) scheduleOnRN(onMove, f, t);
    },
  });

  const swipe = usePanGesture({
    activeOffsetX: [-14, 14],
    failOffsetY: [-10, 10],
    onUpdate: (e) => {
      'worklet';
      tx.value = Math.min(0, e.translationX);
    },
    onDeactivate: () => {
      'worklet';
      if (tx.value < DELETE_AT) {
        tx.value = withTiming(-600, { duration: motion.base });
        scheduleOnRN(onDelete);
      } else tx.value = withSpring(0, { damping: 22, stiffness: 260 });
    },
  });

  const style = useAnimatedStyle(() => {
    const f = from.value;
    if (f < 0) return { zIndex: 0, transform: [{ translateY: 0 }, { scale: 1 }] };
    if (f === index) return { zIndex: 10, transform: [{ translateY: dy.value }, { scale: 1.02 }] };
    const t = to.value;
    const shift = (heights.value[f] ?? 0) + CARD_GAP;
    const y = f < t && index > f && index <= t ? -shift : t < f && index >= t && index < f ? shift : 0;
    return { zIndex: 0, transform: [{ translateY: withTiming(y, { duration: motion.fast }) }, { scale: 1 }] };
  });
  const behind = useAnimatedStyle(() => ({ opacity: tx.value < -8 ? 1 : 0 }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    const l = drag.layout.current;
    l.tops[index] = y;
    l.heights[index] = height;
    tops.value = [...l.tops];
    heights.value = [...l.heights];
  };

  return (
    <Animated.View onLayout={onLayout} style={style}>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 16, backgroundColor: p.sprint.color, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 22 }, behind]}>
        <Icons.trash size={20} color="#FFFFFF" />
      </Animated.View>
      <GestureDetector gesture={swipe}>
        <Animated.View style={slide}>
          <View style={{ flexDirection: 'row', backgroundColor: p.surface, borderRadius: 16 }}>
            <GestureDetector gesture={grip}>
              <View accessibilityLabel={`Drag to reorder ${label}`} style={{ width: 30, alignItems: 'center', paddingTop: 20 }}>
                <Grip color={p.textTertiary} />
              </View>
            </GestureDetector>
            <View style={{ flex: 1 }}>{children}</View>
          </View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

function Grip({ color }: { color: string }) {
  return (
    <Svg width={12} height={18} viewBox="0 0 12 18">
      {[3, 9, 15].flatMap((y) => [<Circle key={`a${y}`} cx={3} cy={y} r={1.6} fill={color} />, <Circle key={`b${y}`} cx={9} cy={y} r={1.6} fill={color} />])}
    </Svg>
  );
}
