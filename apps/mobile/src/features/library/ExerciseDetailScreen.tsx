/** Exercise detail: images, muscles, equipment, instructions and your history with it. */
import { type LoggedSet, formatWeight } from '@fit/core';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, useUnits } from '@/data/store';
import { shortDate } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { IconButton, T } from '@/ui/primitives';
import { detailFor } from './catalog';
import { EQUIPMENT_LABEL, KIND_LABEL, MUSCLE_LABEL } from './labels';
import { StatusShade } from '@/ui/StatusShade';

/** "3 x 8 at 135 lb", or "8, 8, 6" when sets differ. */
export function setsSummary(sets: readonly LoggedSet[], unit: 'lb' | 'kg'): string {
  if (sets.length === 0) return '';
  const same = sets.every((x) => x.reps === sets[0]!.reps && x.weightKg === sets[0]!.weightKg);
  const top = sets.reduce((b, x) => ((x.weightKg ?? 0) > (b.weightKg ?? 0) ? x : b), sets[0]!);
  if (same) return top.weightKg ? `${sets.length} x ${top.reps} at ${formatWeight(top.weightKg, unit)}` : `${sets.length} x ${top.reps}`;
  const reps = sets.map((x) => x.reps).join(', ');
  return top.weightKg ? `${reps}, top ${formatWeight(top.weightKg, unit)}` : reps;
}

export function ExerciseDetailScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const imageWidth = useWindowDimensions().width - 40;
  const { id } = useLocalSearchParams<{ id: string }>();
  const unit = useUnits().weight;
  const [ex] = useState(() => repo.exercise(id));
  const [history] = useState(() => repo.exerciseHistory(id, 8));
  const [hidden, setHidden] = useState(ex?.hidden ?? false);

  if (!ex) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <T v="bodyMedium" tone="secondary">
          Exercise not found
        </T>
      </View>
    );
  }
  const images = ex.imageKeys.map(detailFor).filter((x): x is number => x !== undefined);
  const muscles = [ex.musclePrimary, ...ex.musclesSecondary].map((m) => MUSCLE_LABEL[m]).join(', ');

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <IconButton label="Back" size={40} onPress={() => router.back()}>
          <Icons.chevronLeft size={20} color={p.text} />
        </IconButton>
        {images.length > 0 && (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.images}>
            {images.map((src, i) => (
              <Image key={i} source={src} style={[s.image, { width: imageWidth }]} contentFit="contain" accessibilityLabel={`${ex.name}, image ${i + 1} of ${images.length}`} />
            ))}
          </ScrollView>
        )}
        <View>
          <T v="title" accessibilityRole="header">
            {ex.name}
          </T>
          <T v="caption" tone="secondary">
            {`${KIND_LABEL[ex.kind]}, ${EQUIPMENT_LABEL[ex.equipment].toLowerCase()}${ex.custom ? ', custom' : ''}`}
          </T>
        </View>

        <View style={s.card}>
          <Fact label="Muscles" value={muscles} />
          {ex.sides === 'both' && <Fact label="Sides" value="Left and right" />}
          {ex.defaultHoldS ? <Fact label="Hold" value={`${ex.defaultHoldS} s`} /> : null}
        </View>

        {ex.instructions.length > 0 && (
          <View style={s.card}>
            <T v="headline" style={{ paddingTop: 12, paddingBottom: 4 }}>
              How to
            </T>
            {ex.instructions.map((line, i) => (
              <View key={i} style={s.step}>
                <T v="labelStrong" tone="secondary" style={{ width: 20 }}>
                  {String(i + 1)}
                </T>
                <T v="body" style={{ flex: 1 }}>
                  {line}
                </T>
              </View>
            ))}
          </View>
        )}
        {ex.note ? (
          <View style={[s.card, { paddingVertical: 12 }]}>
            <T v="body">{ex.note}</T>
          </View>
        ) : null}

        {history.length > 0 && (
          <View style={s.card}>
            <T v="headline" style={{ paddingTop: 12, paddingBottom: 4 }}>
              History
            </T>
            {history.map((h) => (
              <View key={h.sessionId} style={[s.histRow]}>
                <T v="bodyMedium" style={{ width: 96 }}>
                  {shortDate(h.date)}
                </T>
                <T v="body" num style={{ flex: 1 }}>
                  {setsSummary(h.sets, unit)}
                </T>
              </View>
            ))}
          </View>
        )}

        {!ex.custom && (
          <View style={[s.card, s.hideRow]}>
            <View style={{ flex: 1 }}>
              <T v="bodyMedium">Hide from lists</T>
              <T v="caption" tone="secondary">
                Hidden exercises stay in your history
              </T>
            </View>
            <Switch
              value={hidden}
              accessibilityLabel="Hide from lists"
              onValueChange={(v) => {
                haptic.tick();
                setHidden(v);
                repo.setExerciseHidden(ex.id, v);
                actions.reload();
              }}
            />
          </View>
        )}
      </ScrollView>
      <StatusShade />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const s = useStyles();
  return (
    <View style={s.fact}>
      <T v="label" tone="secondary" style={{ width: 80 }}>
        {label}
      </T>
      <T v="bodyMedium" style={{ flex: 1 }}>
        {value}
      </T>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, gap: 14 },
  images: { height: 240, borderRadius: 20, backgroundColor: p.surface },
  image: { height: 240 },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14 },
  fact: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  step: { flexDirection: 'row', gap: 8, paddingVertical: 6 },
  histRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: p.divider },
  hideRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
}));
