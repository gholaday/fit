/**
 * Today's weight card (spec §12 Weight): the trend, the last weigh-in, the change and rate,
 * goal progress, and a 30 day line. Shown only while a goal is set (active or just
 * reached). Opens the Weight screen; Weigh in opens the sheet.
 */
import { type GoalProgress, type WeightGoal, type WeightUnit, addDays } from '@fit/core';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { repo } from '@/data';
import { useDataVersion, useToday, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { monthDay } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, T } from '@/ui/primitives';
import { changeLabel, rateLabel, statusLabel, weightLabel, whenLabel } from './format';
import { WeightChart } from './WeightChart';
import { GoalSheet, WeighInSheet } from './WeightSheets';

/** Takes the data version so the memo re-reads after a write. */
function readWeight(_version: number) {
  return { summary: repo.weightSummary(), goal: repo.weightGoal() };
}

export function WeightCard() {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().weight;
  const today = useToday();
  const version = useDataVersion();
  const { summary, goal } = useMemo(() => readWeight(version), [version]);
  const [weighIn, setWeighIn] = useState(false);
  const [goalSheet, setGoalSheet] = useState(false);
  // Today shows weight only alongside a goal; without one it lives on the Weight screen and Stats.
  if (!goal || goal.status === 'stopped') return null;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens your weight"
        onPress={() => {
          haptic.tap();
          router.push('/weight');
        }}
        style={s.card}
      >
        <View style={s.head}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="label" tone="secondary">
              Weight
            </T>
            {summary ? (
              <>
                <T v="title" num>
                  {weightLabel(summary.trendKg, unit)}
                </T>
                <T v="caption" tone="secondary" num>
                  {`Last ${weightLabel(summary.last.kg, unit)}, ${whenLabel(summary.last.measuredAt, today)}`}
                </T>
              </>
            ) : (
              <T v="bodyMedium" tone="secondary">
                No weigh-ins yet
              </T>
            )}
          </View>
          <Button label="Weigh in" kind="outline" size="sm" style={{ borderRadius: 18 }} icon={<Icons.plus size={14} color={p.text} />} onPress={() => setWeighIn(true)} />
        </View>

        {summary && (
          <View style={s.line}>
            <T v="labelStrong" num>{`${changeLabel(summary.changeKg, unit)} since ${monthDay(summary.changeSince)}`}</T>
            {summary.rateKgWeek !== undefined && (
              <T v="label" tone="secondary" num>
                {rateLabel(summary.rateKgWeek, unit)}
              </T>
            )}
          </View>
        )}

        {goal && summary?.progress && <GoalLine goal={goal} progress={summary.progress} unit={unit} onNewGoal={() => setGoalSheet(true)} />}

        {summary && summary.recent.length > 0 && <WeightChart points={summary.recent} from={addDays(today, -29)} to={today} unit={unit} goal={goal} height={56} />}
      </Pressable>
      <WeighInSheet visible={weighIn} onClose={() => setWeighIn(false)} />
      <GoalSheet visible={goalSheet} onClose={() => setGoalSheet(false)} />
    </>
  );
}

/** Progress bar from start to target, the status, and the expected date or the reached date. */
export function GoalLine({ goal, progress, unit, onNewGoal }: { goal: WeightGoal; progress: GoalProgress; unit: WeightUnit; onNewGoal?: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const reached = progress.status === 'reached';
  return (
    <View style={{ gap: 6 }}>
      <View style={s.bar}>
        <View style={[s.barFill, { width: `${progress.progress * 100}%`, backgroundColor: reached ? p.success : p.weight }]} />
      </View>
      <View style={s.line}>
        <T v="labelStrong" num color={reached ? p.stretch.onTint : undefined}>
          {reached ? `Goal reached ${goal.reachedAt ? monthDay(goal.reachedAt) : ''}`.trim() : statusLabel(progress, unit)}
        </T>
        {reached ? (
          onNewGoal && <Button label="Set a new goal" kind="quiet" size="sm" onPress={onNewGoal} />
        ) : (
          <T v="label" tone="secondary" num>
            {`Expected ${monthDay(progress.expectedDate)}`}
          </T>
        )}
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 20, padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bar: { height: 8, borderRadius: 4, backgroundColor: p.ringTrack, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
}));
