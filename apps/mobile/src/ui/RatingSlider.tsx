/**
 * Effort and feel ratings: a big number with its word above a row of rising bars. Tap a
 * bar or drag across them; each new value ticks. Horizontal drags only, so the page still
 * scrolls. Screen readers adjust it with swipe up and down.
 */
import { useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic } from '@/lib/haptics';
import { usePalette } from '@/theme';
import { T } from './primitives';

/** RPE 1 to 10. */
export const RPE_WORDS = ['Very easy', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Hard', 'Hard', 'Very hard', 'Very hard', 'All out'];
/** How a stretch felt, 1 to 5. */
export const FEEL_WORDS = ['Tight', 'Stiff', 'Okay', 'Loose', 'Very loose'];

export function RatingSlider({ value, words, onChange, label, prompt, ends }: { value: number | undefined; words: readonly string[]; onChange: (v: number) => void; label: string; prompt: string; ends: [string, string] }) {
  const p = usePalette();
  const n = words.length;
  const [width, setWidth] = useState(0);
  // Easy end in the stretch green, hard end in sprint clay.
  const tone = (i: number) => (i < n * 0.4 ? p.stretch.color : i < n * 0.7 ? p.hard.color : p.sprint.color);

  const pick = (x: number) => {
    if (width <= 0) return;
    const v = Math.min(n, Math.max(1, Math.floor((x / width) * n) + 1));
    if (v === value) return;
    haptic.tick();
    onChange(v);
  };
  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    failOffsetY: [-12, 12],
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(pick, e.x);
    },
    onUpdate: (e) => {
      'worklet';
      scheduleOnRN(pick, e.x);
    },
  });
  const tap = useTapGesture({
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(pick, e.x);
    },
  });
  const gesture = useCompetingGestures(pan, tap);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, minHeight: 64 }}>
        <T v="display" num style={{ fontSize: 56, lineHeight: 64 }} color={value ? tone(value - 1) : p.textTertiary}>
          {value ? String(value) : '-'}
        </T>
        <T v="headline" tone={value ? 'text' : 'tertiary'}>
          {value ? words[value - 1] : prompt}
        </T>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ text: value ? `${value} of ${n}, ${words[value - 1]}` : 'Not set' }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onChange(Math.min(n, Math.max(1, (value ?? 0) + (e.nativeEvent.actionName === 'increment' ? 1 : -1))))}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          style={{ height: 48, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}
        >
          {words.map((_, i) => (
            <View key={i} style={{ flex: 1, height: 14 + (34 * i) / Math.max(1, n - 1), borderRadius: 6, backgroundColor: value !== undefined && i < value ? tone(i) : p.inset }} />
          ))}
        </View>
      </GestureDetector>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T v="micro" tone="tertiary">
          {ends[0]}
        </T>
        <T v="micro" tone="tertiary">
          {ends[1]}
        </T>
      </View>
    </View>
  );
}
