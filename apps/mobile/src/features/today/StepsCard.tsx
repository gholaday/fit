/**
 * Today's steps under the day ring: the count toward the goal with a progress bar, then a
 * line of steps per hour so far today, which shows when in the day the steps came. Opens Stats.
 */
import type { IsoDate } from '@fit/core';
import { router } from 'expo-router';
import { memo, useEffect, useState } from 'react';
import { type LayoutChangeEvent, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { syncedLabel } from '@/features/health/state';
import { hourlySteps } from '@/features/health/sync';
import { thousands } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { T } from '@/ui/primitives';

const CHART_H = 64;
const TICKS = [0, 6, 12, 18] as const;
/** A sample day for dev builds, where the emulator's Health Connect has no hourly steps. */
const DEV_HOURS = [0, 0, 0, 0, 0, 0, 40, 620, 310, 120, 90, 240, 510, 180, 80, 60, 140, 980, 1240, 420, 210, 90, 0, 0];

/** "6 AM", "12 PM" */
function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** A smooth line through the hours so far, and the same line closed down to the baseline. */
function linePaths(hours: readonly number[], width: number): { line: string; area: string } {
  const max = Math.max(1, ...hours);
  const x = (h: number) => (h / 23) * width;
  const y = (v: number) => CHART_H - 2 - (v / max) * (CHART_H - 6);
  let line = `M ${x(0)} ${y(hours[0]!)}`;
  for (let h = 1; h < hours.length; h++) {
    const mid = (x(h - 1) + x(h)) / 2;
    line += ` C ${mid} ${y(hours[h - 1]!)} ${mid} ${y(hours[h]!)} ${x(h)} ${y(hours[h]!)}`;
  }
  const area = `${line} L ${x(hours.length - 1)} ${CHART_H} L 0 ${CHART_H} Z`;
  return { line, area };
}

export const StepsCard = memo(function StepsCard({ today, steps, goal, lastSyncedAt }: { today: IsoDate; steps?: number; goal: number; lastSyncedAt?: string }) {
  const s = useStyles();
  const p = usePalette();
  const synced = steps !== undefined;
  const met = synced && steps >= goal;
  const frac = synced ? Math.min(1, steps / goal) : 0;
  const [hours, setHours] = useState<number[]>();
  const [width, setWidth] = useState(0);

  // Re-read after each sync. Hours after now stay off the line.
  useEffect(() => {
    let live = true;
    hourlySteps(today)
      .then((h) => live && setHours((__DEV__ && !h?.some((v) => v > 0) ? DEV_HOURS : h)?.slice(0, new Date().getHours() + 1)))
      .catch(() => live && setHours(undefined));
    return () => {
      live = false;
    };
  }, [today, lastSyncedAt]);

  const f = useSharedValue(frac);
  useEffect(() => {
    f.value = withTiming(frac, { duration: 250 });
  }, [frac, f]);
  const fill = useAnimatedStyle(() => ({ width: `${f.value * 100}%` }));

  const shown = hours && hours.some((v) => v > 0) ? hours : undefined;
  const peak = shown ? shown.indexOf(Math.max(...shown)) : -1;
  const paths = shown && width > 0 ? linePaths(shown, width) : undefined;

  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens activity stats" onPress={() => router.navigate('/stats')} style={s.card}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <T v="title" num>
              {synced ? thousands(steps) : 'Steps'}
            </T>
            {synced && (
              <T v="bodyMedium" tone="secondary">
                steps
              </T>
            )}
          </View>
          <T v="caption" tone="secondary" num>
            {synced ? (met ? `Goal of ${thousands(goal)} met` : `of ${thousands(goal)}, ${thousands(goal - steps)} to go`) : 'Not synced yet'}
          </T>
        </View>
        {lastSyncedAt && (
          <T v="caption" tone="tertiary" num>
            {`Synced ${syncedLabel(lastSyncedAt)}`}
          </T>
        )}
      </View>
      <View style={s.bar}>
        <Animated.View style={[s.barFill, { backgroundColor: met ? p.success : p.steps }, fill]} />
      </View>
      {shown && (
        <View accessible accessibilityLabel={`Steps by hour today, most at ${hourLabel(peak)} with ${thousands(shown[peak]!)} steps`} style={{ gap: 6 }}>
          <View style={{ height: CHART_H }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
            {paths && (
              <Svg width={width} height={CHART_H}>
                <Path d={paths.area} fill={p.steps} fillOpacity={0.18} />
                <Path d={paths.line} fill="none" stroke={p.steps} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            )}
          </View>
          <View style={s.ticks}>
            {TICKS.map((h) => (
              <T key={h} v="micro" tone="tertiary" style={[s.tick, { left: `${(h / 23) * 100}%` }]}>
                {hourLabel(h)}
              </T>
            ))}
          </View>
        </View>
      )}
    </Pressable>
  );
});

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 20, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bar: { height: 8, borderRadius: 4, backgroundColor: p.ringTrack, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  ticks: { height: 14 },
  tick: { position: 'absolute', top: 0 },
}));
