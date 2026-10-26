import { type IsoDate, addDays, startOfWeek, weekdayOf } from '@fit/core';
import { memo } from 'react';
import { View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useFit } from '@/data/store';
import { dayOfMonth, weekdayLetter } from '@/lib/format';
import { usePalette } from '@/theme';
import { T } from '@/ui/primitives';

type DayState = 'today' | 'done' | 'plan' | 'rest';

function useDayState(date: IsoDate, today: IsoDate): DayState {
  return useFit(
    useShallow((s) => {
      if (date === today) return 'today';
      const items = (s.byDate[date] ?? []).map((k) => s.items[k]!);
      const main = items.filter((i) => i.lane !== 'stretch');
      if (items.length > 0 && items.every((i) => i.status !== 'pending')) return 'done';
      return main.length > 0 ? 'plan' : 'rest';
    }),
  );
}

const Day = memo(function Day({ date, today }: { date: IsoDate; today: IsoDate }) {
  const p = usePalette();
  const st = useDayState(date, today);
  const bg = st === 'today' ? p.primary : st === 'done' ? p.dayDone : 'transparent';
  const fg = st === 'today' ? p.onPrimary : st === 'rest' ? p.textMuted : p.textBody;
  const label = { today: 'today', done: 'all done', plan: 'planned', rest: 'rest day' }[st];
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }} accessible accessibilityLabel={`${dayOfMonth(date)}, ${label}`}>
      <T v="micro" color={st === 'today' ? p.text : p.textTertiary}>
        {weekdayLetter(weekdayOf(date))}
      </T>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', borderWidth: st === 'plan' ? 1 : 0, borderColor: p.dashed }}>
        <T v="labelStrong" num color={fg}>
          {dayOfMonth(date)}
        </T>
      </View>
    </View>
  );
});

export const WeekStrip = memo(function WeekStrip({ today }: { today: IsoDate }) {
  const monday = startOfWeek(today);
  return (
    <View style={{ flexDirection: 'row' }}>
      {Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => (
        <Day key={d} date={d} today={today} />
      ))}
    </View>
  );
});
