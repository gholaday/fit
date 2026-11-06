/**
 * The week strip on Today (spec §14 Orbit): Monday to Sunday as small day rings in lane
 * colors, each with its weekday letter and date. Today sits in a dark circle, a picked day
 * has an outline, and a dot under a day marks the step goal met. Tapping a day opens it.
 */
import { type IsoDate, addDays, dayRing, startOfWeek, weekdayOf } from '@fit/core';
import { memo, useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useShallow } from 'zustand/react/shallow';
import { repo } from '@/data';
import { actions, useFit, useSettings } from '@/data/store';
import { useHealth } from '@/features/health/state';
import { dayOfMonth, weekdayLetter, weekdayLong } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { usePalette } from '@/theme';
import { T } from '@/ui/primitives';
import { MiniOrbit, laneArcs } from './OrbitRing';

const SIZE = 34;
const WIDTH = 4;

/** Steps per day for the week from `start`. Takes the sync time so the memo re-reads after a sync. */
function stepsOn(start: IsoDate, _syncedAt: string | undefined): Map<IsoDate, number> {
  return new Map(repo.dailyMetricsRange(start, addDays(start, 6)).map((m) => [m.date, m.steps ?? 0]));
}

export const WeekStrip = memo(function WeekStrip({ today, selected, onSelect }: { today: IsoDate; selected: IsoDate; onSelect: (d: IsoDate) => void }) {
  const p = usePalette();
  const start = startOfWeek(selected);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  useEffect(() => actions.ensureRange(start, addDays(start, 6)), [start]);
  const week = useFit(useShallow((st) => days.flatMap((d) => (st.byDate[d] ?? []).map((k) => st.items[k]!))));
  const goal = useSettings().stepGoal;
  const syncedAt = useHealth((h) => h.lastSyncedAt);
  const steps = useMemo(() => stepsOn(start, syncedAt), [start, syncedAt]);

  return (
    <View style={{ flexDirection: 'row' }}>
      {days.map((d) => {
        const items = week.filter((i) => i.date === d);
        const isToday = d === today;
        const picked = d === selected && !isToday;
        const met = (steps.get(d) ?? 0) >= goal;
        const done = items.filter((i) => i.status === 'done').length;
        return (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityState={{ selected: d === selected }}
            accessibilityLabel={`${isToday ? 'Today, ' : ''}${weekdayLong(weekdayOf(d))} ${dayOfMonth(d)}, ${items.length === 0 ? 'rest day' : `${done} of ${items.length} done`}${met ? ', step goal met' : ''}`}
            onPress={() => {
              haptic.tick();
              onSelect(d);
            }}
            style={({ pressed }) => [{ flex: 1, alignItems: 'center', gap: 4, minHeight: 44 }, pressed && { opacity: 0.6 }]}
          >
            <T v="micro" tone={isToday ? 'text' : 'secondary'} style={isToday ? { fontWeight: '700' } : undefined}>
              {weekdayLetter(weekdayOf(d))}
            </T>
            <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
              {isToday ? (
                <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
                  <Circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE / 2} fill={p.primary} />
                </Svg>
              ) : (
                <View style={{ position: 'absolute' }}>
                  <MiniOrbit arcs={laneArcs(dayRing(items, 0), p)} size={SIZE - 4} width={WIDTH} track={p.ringTrack} />
                </View>
              )}
              {picked && <View style={{ position: 'absolute', width: SIZE + 4, height: SIZE + 4, borderRadius: (SIZE + 4) / 2, borderWidth: 1.5, borderColor: p.text }} />}
              <T v="micro" num color={isToday ? p.onPrimary : items.length > 0 ? p.text : p.textSecondary} style={{ fontWeight: isToday ? '700' : '600' }}>
                {dayOfMonth(d)}
              </T>
            </View>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: met ? p.steps : 'transparent' }} />
          </Pressable>
        );
      })}
    </View>
  );
});
