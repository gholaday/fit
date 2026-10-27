/** A run workout's steps, one line each with amount and target; repeats grouped under "4x". */
import { type WorkoutItem, isRepeat } from '@fit/core';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { useUnits } from '@/data/store';
import { stepName, stepTone } from '@/features/run/steps';
import { createStyles, toneColor, usePalette } from '@/theme';
import { T } from '@/ui/primitives';
import { stepLine } from './describe';

export function WorkoutSteps({ items, vdot, style }: { items: readonly WorkoutItem[]; vdot: number | undefined; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().distance;
  return (
    <View style={[s.card, style]}>
      {items.map((it, i) =>
        isRepeat(it) ? (
          <View key={it.id} style={[s.block, i > 0 && s.divider]}>
            <T v="labelStrong" tone="secondary">{`${it.repeat}x`}</T>
            <View style={{ flex: 1, gap: 8 }}>
              {it.steps.map((st) => (
                <StepLine key={st.id} name={stepName(st)} line={stepLine(st, unit, vdot)} color={toneColor(p, stepTone(st))} />
              ))}
            </View>
          </View>
        ) : (
          <View key={it.id} style={[s.block, i > 0 && s.divider]}>
            <StepLine name={stepName(it)} line={stepLine(it, unit, vdot)} color={toneColor(p, stepTone(it))} />
          </View>
        ),
      )}
    </View>
  );
}

function StepLine({ name, line, color }: { name: string; line: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <View style={{ flex: 1 }}>
        <T v="bodyMedium">{name}</T>
        <T v="caption" tone="secondary" num>
          {line}
        </T>
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14 },
  block: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
