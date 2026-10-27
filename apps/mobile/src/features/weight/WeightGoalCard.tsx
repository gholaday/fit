/**
 * The Plan screen's weight goal card (spec §12 Weight): target, pace, expected date and
 * progress, or "Set a weight goal". Opens the Weight screen.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { repo } from '@/data';
import { useDataVersion, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { monthDay } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Button, T } from '@/ui/primitives';
import { paceLabel, statusLabel, weightLabel } from './format';
import { GoalSheet } from './WeightSheets';

/** Takes the data version so the memo re-reads after a write. */
function readGoal(_version: number) {
  const goal = repo.weightGoal();
  return { goal: goal?.status === 'stopped' ? undefined : goal, progress: repo.weightSummary()?.progress };
}

export function WeightGoalCard() {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().weight;
  const version = useDataVersion();
  const { goal, progress } = useMemo(() => readGoal(version), [version]);
  const [setting, setSetting] = useState(false);

  if (!goal) {
    return (
      <View style={s.card}>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">No weight goal</T>
          <T v="caption" tone="secondary">
            Track your weight toward a target
          </T>
        </View>
        <Button label="Set a weight goal" kind="outline" size="sm" onPress={() => setSetting(true)} />
        <GoalSheet visible={setting} onClose={() => setSetting(false)} />
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens your weight"
      onPress={() => {
        haptic.tap();
        router.push('/weight');
      }}
      style={[s.card, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}
    >
      <View style={s.line}>
        <T v="bodyStrong" num>{`Weight goal ${weightLabel(goal.targetKg, unit)}`}</T>
        <T v="caption" tone="secondary" num>
          {paceLabel(goal.paceKgWeek, unit)}
        </T>
      </View>
      {progress && (
        <>
          <View style={s.bar}>
            <View style={[s.barFill, { width: `${progress.progress * 100}%`, backgroundColor: progress.status === 'reached' ? p.success : p.weight }]} />
          </View>
          <View style={s.line}>
            <T v="caption" tone="secondary" num>
              {progress.status === 'reached' ? `Reached ${goal.reachedAt ? monthDay(goal.reachedAt) : ''}`.trim() : statusLabel(progress, unit)}
            </T>
            {progress.status !== 'reached' && (
              <T v="caption" tone="secondary" num>
                {`Expected ${monthDay(progress.expectedDate)}`}
              </T>
            )}
          </View>
        </>
      )}
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bar: { height: 6, borderRadius: 3, backgroundColor: p.ringTrack, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
}));
