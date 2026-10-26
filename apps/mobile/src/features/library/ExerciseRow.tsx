import type { ExerciseSummary } from '@fit/core';
import { Image } from 'expo-image';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';
import { thumbFor } from './catalog';
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from './labels';

/** Fixed row height, so FlashList never measures. */
export const EXERCISE_ROW_HEIGHT = 64;

export const ExerciseRow = memo(function ExerciseRow({ exercise, onPress, selected }: { exercise: ExerciseSummary; onPress: () => void; selected?: boolean }) {
  const s = useStyles();
  const p = usePalette();
  const thumb = thumbFor(exercise.thumbKey);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
    >
      {thumb ? <Image source={thumb} style={s.thumb} contentFit="cover" recyclingKey={exercise.id} transition={0} /> : <View style={[s.thumb, s.noThumb]}>{<Icons.barbell size={18} color={p.textTertiary} />}</View>}
      <View style={{ flex: 1 }}>
        <T v="bodyMedium" numberOfLines={1}>
          {exercise.name}
        </T>
        <T v="caption" tone="secondary" numberOfLines={1}>
          {`${MUSCLE_LABEL[exercise.musclePrimary]}, ${EQUIPMENT_LABEL[exercise.equipment].toLowerCase()}${exercise.custom ? ', custom' : ''}`}
        </T>
      </View>
      {selected !== undefined && (
        <View style={[s.check, selected && { backgroundColor: p.primary, borderColor: p.primary }]}>{selected && <Icons.check size={14} color={p.onPrimary} />}</View>
      )}
    </Pressable>
  );
});

const useStyles = createStyles((p) => ({
  row: { height: EXERCISE_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.surface, marginBottom: 6 },
  thumb: { width: 44, height: 44, borderRadius: 10, backgroundColor: p.inset },
  noThumb: { alignItems: 'center', justifyContent: 'center' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: p.dashed, alignItems: 'center', justifyContent: 'center' },
}));
