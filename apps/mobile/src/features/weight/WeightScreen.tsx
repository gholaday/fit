/**
 * Weight screen (spec §12 Weight): the chart in 1M, 3M, 6M and All, the goal with Edit
 * and Stop, and every weigh-in newest first. Swipe a row to delete it; tap a manual row
 * to edit it.
 */
import { type IsoDate, type WeighIn, addDays } from '@fit/core';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useDataVersion, useToday, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { longDate, monthDay } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, Segmented, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { paceLabel, timeOfDay, weightLabel } from './format';
import { GoalLine } from './WeightCard';
import { WeightChart } from './WeightChart';
import { GoalSheet, WeighInSheet } from './WeightSheets';

type Range = '1m' | '3m' | '6m' | 'all';
const RANGE_DAYS: Record<Exclude<Range, 'all'>, number> = { '1m': 30, '3m': 91, '6m': 182 };
const PAGE = 60;

/** Takes the data version so the memo re-reads after a write. */
function readAll(limit: number, _version: number) {
  return { summary: repo.weightSummary(), goal: repo.weightGoal(), trend: repo.weightTrend(), list: repo.weighIns(limit) };
}

export function WeightScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().weight;
  const today = useToday();
  const version = useDataVersion();
  const [limit, setLimit] = useState(PAGE);
  const { summary, goal, trend, list } = useMemo(() => readAll(limit, version), [limit, version]);
  const [range, setRange] = useState<Range>('3m');
  const [weighIn, setWeighIn] = useState(false);
  const [editing, setEditing] = useState<{ id: string; kg: number }>();
  const [goalSheet, setGoalSheet] = useState(false);
  const [stopping, setStopping] = useState(false);

  const from: IsoDate = range === 'all' ? (trend[0]?.date ?? addDays(today, -29)) : addDays(today, -(RANGE_DAYS[range] - 1));
  const points = trend.filter((t) => t.date >= from);
  const active = goal && goal.status !== 'stopped' ? goal : undefined;

  const header = (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      <View style={s.top}>
        <IconButton label="Back" size={40} onPress={() => router.back()}>
          <Icons.chevronLeft size={20} color={p.text} />
        </IconButton>
        <T v="heading" accessibilityRole="header" style={{ flex: 1 }}>
          Weight
        </T>
        <Button label="Weigh in" kind="outline" size="sm" style={{ borderRadius: 18 }} icon={<Icons.plus size={14} color={p.text} />} onPress={() => setWeighIn(true)} />
      </View>

      <View style={s.card}>
        {summary ? (
          <View>
            <T v="display" num>
              {weightLabel(summary.trendKg, unit)}
            </T>
            <T v="caption" tone="secondary">
              Trend, which smooths out day to day changes
            </T>
          </View>
        ) : (
          <T v="bodyMedium" tone="secondary">
            Weigh in to start your trend
          </T>
        )}
        {trend.length > 0 && (
          <Segmented
            look="inset"
            options={[
              { value: '1m', label: '1M' },
              { value: '3m', label: '3M' },
              { value: '6m', label: '6M' },
              { value: 'all', label: 'All' },
            ]}
            value={range}
            onChange={setRange}
          />
        )}
        {points.length > 0 ? (
          <WeightChart points={points} from={from} to={today} unit={unit} goal={active} height={180} axes />
        ) : (
          trend.length > 0 && (
            <T v="caption" tone="tertiary" align="center" style={{ paddingVertical: 24 }}>
              No weigh-ins in this range
            </T>
          )
        )}
      </View>

      <View style={s.card}>
        <T v="headline">Goal</T>
        {active ? (
          <>
            <View style={s.facts}>
              <Fact label="Start" value={weightLabel(active.startKg, unit)} />
              <Fact label="Target" value={weightLabel(active.targetKg, unit)} />
              <Fact label="Pace" value={paceLabel(active.paceKgWeek, unit)} />
            </View>
            {summary?.progress && <GoalLine goal={active} progress={summary.progress} unit={unit} />}
            <T v="caption" tone="secondary">{`Started ${monthDay(active.startDate)}`}</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label={active.status === 'reached' ? 'Set a new goal' : 'Edit goal'} kind="outline" size="sm" style={{ flex: 1 }} onPress={() => setGoalSheet(true)} />
              {active.status === 'active' && <Button label="Stop goal" kind="quiet" size="sm" style={{ flex: 1 }} onPress={() => setStopping(true)} />}
            </View>
          </>
        ) : (
          <>
            <T v="body" tone="secondary">
              Pick a target and a pace, and Fit shows when you can expect to reach it.
            </T>
            <Button label="Set a weight goal" kind="outline" size="sm" onPress={() => setGoalSheet(true)} />
          </>
        )}
      </View>

      {list.length > 0 && (
        <T v="labelStrong" tone="secondary">
          Weigh-ins
        </T>
      )}
    </View>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <FlatList
        data={list}
        keyExtractor={(w) => w.id}
        ListHeaderComponent={header}
        renderItem={({ item }) => <WeighInRow item={item} onEdit={() => setEditing({ id: item.id, kg: item.kg })} />}
        ItemSeparatorComponent={Separator}
        onEndReached={() => list.length === limit && setLimit(limit + PAGE)}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}
      />
      <WeighInSheet visible={weighIn || editing !== undefined} editing={editing} onClose={() => (setWeighIn(false), setEditing(undefined))} />
      <GoalSheet visible={goalSheet} onClose={() => setGoalSheet(false)} />
      <Sheet visible={stopping} onClose={() => setStopping(false)} title="Stop this goal">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            Your weigh-ins stay. You can set a new goal any time.
          </T>
          <Button
            label="Stop goal"
            onPress={() => {
              haptic.commit();
              repo.stopWeightGoal();
              actions.reload();
              setStopping(false);
              showSnack({ message: 'Goal stopped' });
            }}
          />
          <Button label="Keep it" kind="outline" onPress={() => setStopping(false)} />
        </View>
      </Sheet>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <T v="caption" tone="secondary">
        {label}
      </T>
      <T v="bodyStrong" num>
        {value}
      </T>
    </View>
  );
}

function Separator() {
  return <View style={{ height: 8 }} />;
}

const WeighInRow = memo(function WeighInRow({ item, onEdit }: { item: WeighIn; onEdit: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().weight;
  const manual = item.source === 'manual';
  const remove = () => {
    haptic.commit();
    repo.deleteWeighIn(item.id);
    actions.reload();
    showSnack({ message: 'Weigh-in deleted' });
  };
  return (
    <ReanimatedSwipeable
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable accessibilityRole="button" accessibilityLabel="Delete weigh-in" onPress={remove} style={s.delete}>
          <Icons.trash size={20} color={p.onPrimary} />
        </Pressable>
      )}
    >
      <Pressable
        accessibilityRole={manual ? 'button' : undefined}
        accessibilityHint={manual ? 'Edits this weigh-in' : undefined}
        accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && remove()}
        disabled={!manual}
        onPress={onEdit}
        style={s.row}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <T v="bodyMedium" num>
            {weightLabel(item.kg, unit)}
          </T>
          <T v="caption" tone="secondary" num>
            {`${longDate(item.date)}, ${timeOfDay(item.measuredAt)}`}
          </T>
        </View>
        <T v="caption" tone="tertiary">
          {manual ? 'Manual' : 'Health Connect'}
        </T>
      </Pressable>
    </ReanimatedSwipeable>
  );
});

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: p.surface, borderRadius: 20, padding: 16, gap: 12 },
  facts: { flexDirection: 'row', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  delete: { width: 72, marginLeft: 8, borderRadius: 14, backgroundColor: p.sprint.color, alignItems: 'center', justifyContent: 'center' },
}));
