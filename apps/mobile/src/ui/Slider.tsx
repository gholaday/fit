/**
 * Horizontal slider. The thumb follows the finger on the UI thread; each move reports the
 * value, snapped to `step`, to `onChange`. Horizontal drags only, so the page still scrolls.
 * Screen readers adjust it with swipe up and down by `step`.
 */
import { useEffect } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { motion, usePalette } from '@/theme';

const THUMB = 28;
const TRACK = 6;

export function Slider({ value, min, max, step, onChange, label, valueText }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string; valueText: string }) {
  const p = usePalette();
  const width = useSharedValue(0);
  const pos = useSharedValue(0);
  const dragging = useSharedValue(false);
  const span = Math.max(step, max - min);
  const snap = (v: number) => Math.round(Math.max(min, Math.min(max, v)) / step) * step;

  // Follow the value from outside (buttons, reloads) unless the finger is on it.
  useEffect(() => {
    if (!dragging.value) pos.value = withTiming(Math.max(0, Math.min(1, (value - min) / span)), { duration: motion.fast });
  }, [value, min, span, dragging, pos]);

  const report = (f: number) => onChange(snap(min + f * span));
  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    failOffsetY: [-12, 12],
    onActivate: (e) => {
      'worklet';
      dragging.value = true;
      pos.value = Math.max(0, Math.min(1, e.x / Math.max(1, width.value)));
      scheduleOnRN(report, pos.value);
    },
    onUpdate: (e) => {
      'worklet';
      pos.value = Math.max(0, Math.min(1, e.x / Math.max(1, width.value)));
      scheduleOnRN(report, pos.value);
    },
    onFinalize: () => {
      'worklet';
      dragging.value = false;
    },
  });

  const fill = useAnimatedStyle(() => ({ width: pos.value * width.value }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * width.value - THUMB / 2 }] }));

  return (
    <GestureDetector gesture={pan}>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => onChange(snap(value + (e.nativeEvent.actionName === 'increment' ? step : -step)))}
        onLayout={(e: LayoutChangeEvent) => {
          width.value = e.nativeEvent.layout.width;
        }}
        style={{ height: 44, justifyContent: 'center', marginHorizontal: THUMB / 2 }}
      >
        <View style={{ height: TRACK, borderRadius: TRACK / 2, backgroundColor: p.inset, overflow: 'hidden' }}>
          <Animated.View style={[{ height: TRACK, backgroundColor: p.primary }, fill]} />
        </View>
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', left: 0, width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: p.surface, borderWidth: 2, borderColor: p.primary, elevation: 2 }, thumb]}
        />
      </View>
    </GestureDetector>
  );
}
