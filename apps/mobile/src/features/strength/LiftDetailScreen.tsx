/**
 * A saved strength session (`/lift/[id]`): duration, sets and volume, the records it set,
 * each exercise's sets in the order they were done, and the effort and note.
 */
import { formatWeight, kgToUnit, volumeKg } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { useUnits } from '@/data/store';
import { thousands } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { NotFound } from '@/ui/NotFound';
import { RPE_WORDS } from '@/ui/RatingSlider';
import { IconButton, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { whenLabel } from '@/features/health/ActivityModal';
import { RecordRow, Trophy } from '@/features/records/records';

export function LiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const unit = units.weight;
  const [session] = useState(() => repo.strengthSession(id));
  const [records] = useState(() => repo.sessionRecords(id));
  if (!session) return <NotFound message="Workout not found" />;

  const minutes = Math.max(1, Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60000));
  const volume = volumeKg(session.sets);
  // Exercises in the order they were first done, each with its sets in order.
  const exercises = [...new Set(session.sets.map((x) => x.exerciseId))].map((exerciseId) => ({ exerciseId, sets: session.sets.filter((x) => x.exerciseId === exerciseId) }));

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <T v="headline" numberOfLines={1}>
              {session.name}
            </T>
            <T v="caption" tone="secondary">
              {whenLabel(session.startedAt)}
            </T>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={s.stats}>
          <Stat value={`${minutes} min`} label="Duration" />
          <Stat value={String(session.sets.length)} label="Sets" />
          <Stat value={volume > 0 ? `${thousands(Math.round(kgToUnit(volume, unit)))} ${unit}` : '-'} label="Volume" />
        </View>

        {records.length > 0 && (
          <View style={[s.card, { paddingTop: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
              <Trophy size={20} />
              <T v="headline">New records</T>
            </View>
            {records.map((e, i) => (
              <RecordRow key={e.key} e={e} units={units} withExercise first={i === 0} />
            ))}
          </View>
        )}

        {exercises.map((ex) => (
          <View key={ex.exerciseId} style={s.card}>
            <T v="bodyStrong" numberOfLines={1} style={{ paddingTop: 12, paddingBottom: 4 }}>
              {repo.exercise(ex.exerciseId)?.name ?? 'Exercise'}
            </T>
            {ex.sets.map((x, i) => (
              <View key={`${x.setIdx}-${i}`} style={[s.setRow, i > 0 && s.divider]}>
                <T v="labelStrong" tone="secondary" num style={{ width: 28 }}>
                  {String(i + 1)}
                </T>
                <T v="body" num style={{ flex: 1 }}>
                  {x.durationS ? `${x.durationS} s` : x.weightKg ? `${formatWeight(x.weightKg, unit)} x ${x.reps}` : `${x.reps} reps`}
                </T>
              </View>
            ))}
          </View>
        ))}

        {(session.rpe !== undefined || session.notes) && (
          <View style={[s.card, { paddingVertical: 12, gap: 6 }]}>
            {session.rpe !== undefined && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <T v="bodyMedium">Effort</T>
                <T v="labelStrong" num>{`${session.rpe} of 10, ${RPE_WORDS[session.rpe - 1]?.toLowerCase() ?? ''}`}</T>
              </View>
            )}
            {session.notes && (
              <T v="body" tone="secondary">
                {session.notes}
              </T>
            )}
          </View>
        )}
      </ScrollView>
      <StatusShade />
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="title" num>
        {value}
      </T>
      <T v="caption" tone="secondary">
        {label}
      </T>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 16, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center' },
  stats: { flexDirection: 'row', gap: 10, paddingVertical: 8, paddingHorizontal: 4 },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14, paddingBottom: 4 },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
