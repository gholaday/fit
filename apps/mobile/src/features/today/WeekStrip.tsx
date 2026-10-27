/**
 * Day strip under the Today header: one row of days that scrolls back and forward in
 * time, opening with today in the middle. Tapping a day selects it; the selected day is
 * filled, today keeps a ring when another day is selected.
 */
import { type IsoDate, addDays, diffDays, weekdayOf } from '@fit/core';
import { memo, useRef, useState } from 'react';
import { FlatList, type LayoutChangeEvent, Pressable, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useFit } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { dayOfMonth, weekdayLetter } from '@/lib/format';
import { usePalette } from '@/theme';
import { T } from '@/ui/primitives';

/** Days either side of today. */
const SPAN = 56;

type DayState = 'done' | 'plan' | 'rest';

/** Days outside the loaded window read as rest until they are selected (and loaded). */
function useDayState(date: IsoDate): DayState {
  return useFit(
    useShallow((s) => {
      const items = (s.byDate[date] ?? []).map((k) => s.items[k]!);
      const main = items.filter((i) => i.lane !== 'stretch');
      if (items.length > 0 && items.every((i) => i.status !== 'pending')) return 'done';
      return main.length > 0 ? 'plan' : 'rest';
    }),
  );
}

const Day = memo(function Day({ date, today, selected, width, onSelect }: { date: IsoDate; today: IsoDate; selected: boolean; width: number; onSelect: (d: IsoDate) => void }) {
  const p = usePalette();
  const st = useDayState(date);
  const isToday = date === today;
  const bg = selected ? p.primary : st === 'done' ? p.dayDone : 'transparent';
  const fg = selected ? p.onPrimary : st === 'rest' ? p.textMuted : p.textBody;
  const label = { done: 'all done', plan: 'planned', rest: 'rest day' }[st];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${isToday ? 'Today, ' : ''}${dayOfMonth(date)}, ${label}`}
      onPress={() => {
        haptic.tick();
        onSelect(date);
      }}
      style={{ width, alignItems: 'center', gap: 6 }}
    >
      <T v="micro" color={selected || isToday ? p.text : p.textTertiary}>
        {weekdayLetter(weekdayOf(date))}
      </T>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: isToday && !selected ? 2 : st === 'plan' && !selected ? 1 : 0,
          borderColor: isToday && !selected ? p.primary : p.dashed,
        }}
      >
        <T v="labelStrong" num color={fg}>
          {dayOfMonth(date)}
        </T>
      </View>
    </Pressable>
  );
});

export const WeekStrip = memo(function WeekStrip({ today, selected, onSelect }: { today: IsoDate; selected: IsoDate; onSelect: (d: IsoDate) => void }) {
  const [width, setWidth] = useState(0);
  const list = useRef<FlatList<IsoDate>>(null);
  const days = Array.from({ length: SPAN * 2 + 1 }, (_, i) => addDays(today, i - SPAN));
  const dayW = width / 7;
  // Today in the middle: three days either side.
  const offsetFor = (d: IsoDate) => Math.max(0, (diffDays(addDays(today, -SPAN), d) - 3) * dayW);

  return (
    <View style={{ marginHorizontal: -4 }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <FlatList
          ref={list}
          horizontal
          data={days}
          keyExtractor={(d) => d}
          showsHorizontalScrollIndicator={false}
          getItemLayout={(_, i) => ({ length: dayW, offset: dayW * i, index: i })}
          contentOffset={{ x: offsetFor(selected), y: 0 }}
          snapToInterval={dayW}
          decelerationRate="fast"
          initialNumToRender={21}
          windowSize={5}
          renderItem={({ item }) => <Day date={item} today={today} selected={item === selected} width={dayW} onSelect={onSelect} />}
          extraData={selected}
        />
      )}
    </View>
  );
});
