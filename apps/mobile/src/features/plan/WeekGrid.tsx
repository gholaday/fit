import { type AgendaItem, type IsoDate, LANE_ORDER, addDays, weekdayOf } from '@fit/core';
import { memo, useCallback, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { type AnimatedRef, type SharedValue, measure, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { useShallow } from 'zustand/react/shallow';
import { useFit, useRoutines } from '@/data/store';
import { openItemSheet } from '@/features/items/ItemSheet';
import { cellMeta } from '@/features/items/meta';
import { startMove } from '@/features/move/moveFlow';
import { dayOfMonth, weekdayShort } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, motion, usePalette } from '@/theme';
import { LANE_ICON } from '@/ui/icons';
import { T } from '@/ui/primitives';

const LONG_PRESS_MS = 280;
const tick = haptic.tick;
const SPRING = { damping: 22, stiffness: 240 };

interface DragContext {
  /** Row the finger is over, -1 when outside the week. */
  hover: SharedValue<number>;
  /** Row page bounds, measured at pickup: [top0, bottom0, top1, bottom1, ...]. */
  bounds: SharedValue<number[]>;
  rowRefs: readonly AnimatedRef<View>[];
  dates: readonly IsoDate[];
  onPickup: (key: string, row: number) => void;
  /** Returns true when the item left its row (so it should not spring back). */
  onDrop: (key: string, row: number) => boolean;
}

/**
 * Plan week: one row per day with the Run, Workout and Stretch lanes. Long-press any
 * item and drag it to another day. Tracking, hover detection and the lifted item all
 * run on the UI thread; JS only hears about pickup, each new day hovered (haptic tick)
 * and the drop.
 */
export function WeekGrid({ weekStart, today }: { weekStart: IsoDate; today: IsoDate }) {
  const s = useStyles();
  const p = usePalette();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const r0 = useAnimatedRef<View>();
  const r1 = useAnimatedRef<View>();
  const r2 = useAnimatedRef<View>();
  const r3 = useAnimatedRef<View>();
  const r4 = useAnimatedRef<View>();
  const r5 = useAnimatedRef<View>();
  const r6 = useAnimatedRef<View>();
  const rowRefs = [r0, r1, r2, r3, r4, r5, r6];
  const hover = useSharedValue(-1);
  const bounds = useSharedValue<number[]>([]);
  const [liftedRow, setLiftedRow] = useState(-1);

  const onPickup = useCallback((_key: string, row: number) => {
    haptic.lift();
    setLiftedRow(row);
  }, []);

  const onDrop = useCallback(
    (key: string, row: number) => {
      setLiftedRow(-1);
      const target = dates[row];
      const before = useFit.getState().items[key]?.date;
      if (target && target !== before) startMove(key, target);
      return useFit.getState().items[key]?.date !== before;
    },
    [dates],
  );

  const ctx: DragContext = { hover, bounds, rowRefs, dates, onPickup, onDrop };

  return (
    <View style={{ gap: 4 }}>
      <View style={s.laneHead}>
        <View style={{ width: 38 }} />
        {LANE_ORDER.map((lane) => {
          const Icon = LANE_ICON[lane];
          return (
            <View key={lane} style={s.laneLabel}>
              <Icon size={13} color={p.textTertiary} />
              <T v="micro" tone="tertiary" style={{ fontWeight: '400' }}>
                {lane === 'run' ? 'Run' : lane === 'workout' ? 'Workout' : 'Stretch'}
              </T>
            </View>
          );
        })}
      </View>
      {dates.map((d, i) => (
        <DayRow key={d} index={i} date={d} isToday={d === today} lifted={liftedRow === i} ctx={ctx} rowRef={rowRefs[i]!} />
      ))}
    </View>
  );
}

const DayRow = memo(function DayRow({ index, date, isToday, lifted, ctx, rowRef }: { index: number; date: IsoDate; isToday: boolean; lifted: boolean; ctx: DragContext; rowRef: AnimatedRef<View> }) {
  const s = useStyles();
  const p = usePalette();
  const items = useFit(useShallow((st) => (st.byDate[date] ?? []).map((k) => st.items[k]!)));
  const hover = ctx.hover;
  const ringStyle = useAnimatedStyle(() => {
    const on = hover.value === index;
    return {
      borderColor: on ? p.primary : isToday ? p.primary : 'transparent',
      backgroundColor: on ? p.segmentActive : 'transparent',
    };
  });
  return (
    <Animated.View ref={rowRef} style={[s.row, ringStyle, lifted && { zIndex: 10 }]}>
      <View style={s.dayLabel} accessible accessibilityLabel={`${weekdayShort(weekdayOf(date))} ${dayOfMonth(date)}`}>
        <T v="tiny" tone="secondary">
          {weekdayShort(weekdayOf(date))}
        </T>
        <T v="bodyStrong" num>
          {dayOfMonth(date)}
        </T>
      </View>
      {LANE_ORDER.map((lane) => (
        <LaneCell key={lane} items={items.filter((i) => i.lane === lane)} row={index} ctx={ctx} />
      ))}
    </Animated.View>
  );
});

function LaneCell({ items, row, ctx }: { items: AgendaItem[]; row: number; ctx: DragContext }) {
  const s = useStyles();
  if (items.length === 0) return <View style={s.cell} />;
  return (
    <View style={[s.cell, { gap: 3 }]}>
      {items.map((item) => (
        <DraggableItem key={item.key} item={item} row={row} ctx={ctx} compact={items.length > 1} />
      ))}
    </View>
  );
}

const DraggableItem = memo(function DraggableItem({ item, row, ctx, compact }: { item: AgendaItem; row: number; ctx: DragContext; compact: boolean }) {
  const s = useStyles();
  const p = usePalette();
  const routines = useRoutines();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lifted = useSharedValue(0);
  const { hover, bounds, rowRefs, onPickup, onDrop } = ctx;
  const key = item.key;

  const reset = () => {
    'worklet';
    tx.value = withSpring(0, SPRING);
    ty.value = withSpring(0, SPRING);
    lifted.value = withTiming(0, { duration: motion.fast });
  };

  const drop = (target: number) => {
    // Still on its old day (same row, or waiting on a question): settle back.
    if (!onDrop(key, target)) scheduleOnUI(reset);
  };

  const pan = usePanGesture({
    activateAfterLongPress: LONG_PRESS_MS,
    onActivate: () => {
      'worklet';
      const b: number[] = [];
      for (const ref of rowRefs) {
        const m = measure(ref);
        b.push(m ? m.pageY : 0, m ? m.pageY + m.height : 0);
      }
      bounds.value = b;
      hover.value = row;
      lifted.value = withTiming(1, { duration: motion.fast });
      scheduleOnRN(onPickup, key, row);
    },
    onUpdate: (e) => {
      'worklet';
      tx.value = e.translationX;
      ty.value = e.translationY;
      const b = bounds.value;
      let next = -1;
      for (let i = 0; i < b.length / 2; i++) {
        if (e.absoluteY >= b[i * 2]! && e.absoluteY <= b[i * 2 + 1]!) next = i;
      }
      if (next !== -1 && next !== hover.value) {
        hover.value = next;
        scheduleOnRN(tick);
      }
    },
    onDeactivate: () => {
      'worklet';
      const target = hover.value;
      hover.value = -1;
      scheduleOnRN(drop, target === -1 ? row : target);
    },
    onFinalize: (e) => {
      'worklet';
      if (e.canceled) {
        hover.value = -1;
        reset();
      }
    },
  });

  const tap = useTapGesture({
    onActivate: () => {
      'worklet';
      scheduleOnRN(openItemSheet, key, 'actions');
    },
  });

  const gesture = useCompetingGestures(pan, tap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lifted.value * 0.06 }],
    shadowOpacity: lifted.value * 0.18,
    elevation: lifted.value * 8,
    zIndex: lifted.value > 0 ? 20 : 0,
  }));

  const c = laneColor(p, item.lane);
  const resolved = item.status !== 'pending';
  const name = item.lane === 'stretch' ? item.title.replace(/ stretch$/, '') : item.title;
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${item.title}, ${cellMeta(item, routines)}`}
        accessibilityHint="Opens actions. Hold and drag to move to another day."
        style={[s.item, compact && s.itemCompact, { backgroundColor: c.tint }, style]}
      >
        <View style={{ opacity: resolved ? 0.5 : 1 }}>
          <T v="captionStrong" numberOfLines={compact ? 1 : 2} style={{ lineHeight: 14, textDecorationLine: item.status === 'skipped' ? 'line-through' : 'none' }}>
            {name}
          </T>
          {!compact && (
            <T v="tiny" tone="secondary" style={{ fontWeight: '400' }} numberOfLines={1}>
              {cellMeta(item, routines)}
            </T>
          )}
        </View>
      </Animated.View>
    </GestureDetector>
  );
});

const useStyles = createStyles(() => ({
  laneHead: { flexDirection: 'row', gap: 6, paddingBottom: 2 },
  laneLabel: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4 },
  row: { flexDirection: 'row', gap: 6, paddingVertical: 4, borderRadius: 12, borderWidth: 1.5 },
  dayLabel: { width: 38, paddingTop: 4, paddingLeft: 6 },
  cell: { flex: 1, minHeight: 44, justifyContent: 'center' },
  item: { minHeight: 44, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8, justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowRadius: 10 },
  itemCompact: { minHeight: 28, paddingVertical: 6 },
}));

