/**
 * A routine: its exercises or moves, Start, and Edit for your own or Duplicate for
 * starters (starters are read-only).
 */
import { type RoutineDetail, formatMinutes, formatWeight } from '@fit/core';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, LaneTile, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';

export interface ItemView {
  name: string;
  line: string;
}

/** Names and summary lines for a routine's items, one exercise lookup each. */
export function useItemViews(routine: RoutineDetail | undefined): ItemView[] {
  const unit = useUnits().weight;
  return useMemo(() => {
    if (!routine) return [];
    const r = routine.items;
    return r.items.map((item) => {
      const ex = repo.exercise(item.exerciseId);
      const name = ex?.name ?? 'Missing exercise';
      if (r.kind === 'strength' && 'sets' in item) {
        const w = item.weightKg ? `, ${formatWeight(item.weightKg, unit)}` : '';
        return { name, line: `${item.sets} x ${item.reps}${w}, rest ${item.restS} s` };
      }
      if ('holdS' in item) return { name, line: item.sides === 'both' ? `${item.holdS} s each side` : `${item.holdS} s` };
      return { name, line: '' };
    });
  }, [routine, unit]);
}

export function RoutineScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [routine, setRoutine] = useState(() => repo.routine(id));
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Coming back from the editor shows the saved version.
  useFocusEffect(useCallback(() => setRoutine(repo.routine(id)), [id]));
  const items = useItemViews(routine);

  if (!routine) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <T v="bodyMedium" tone="secondary">
          Routine not found
        </T>
      </View>
    );
  }
  const starter = routine.origin === 'starter';
  const strength = routine.kind === 'strength';

  const duplicate = () => {
    const copy = repo.duplicateRoutine(routine.id, `${routine.name} copy`);
    actions.reload();
    haptic.success();
    showSnack({ message: 'Copy made, edit it as you like' });
    router.replace({ pathname: '/routine/edit', params: { id: copy } });
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {starter ? (
              <Button label="Duplicate" size="sm" kind="quiet" onPress={duplicate} />
            ) : (
              <Button label="Edit" size="sm" kind="quiet" onPress={() => router.push({ pathname: '/routine/edit', params: { id: routine.id } })} />
            )}
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <LaneTile lane={strength ? 'workout' : 'stretch'} size={44} />
          <View style={{ flex: 1 }}>
            <T v="title" accessibilityRole="header">
              {routine.name}
            </T>
            <T v="caption" tone="secondary">
              {`${routine.itemCount} ${strength ? 'exercises' : 'moves'}, about ${formatMinutes(routine.estSeconds)}${starter ? ', starter' : ''}`}
            </T>
          </View>
        </View>
        {starter && (
          <T v="caption" tone="tertiary">
            Starter routines are read-only. Duplicate to change moves or times.
          </T>
        )}

        <View style={s.card}>
          {items.map((it, i) => (
            <View key={i} style={[s.item, i > 0 && s.divider]}>
              <T v="labelStrong" tone="tertiary" num style={s.index}>
                {String(i + 1)}
              </T>
              <View style={{ flex: 1 }}>
                <T v="bodyMedium" numberOfLines={1}>
                  {it.name}
                </T>
                <T v="caption" tone="secondary" num>
                  {it.line}
                </T>
              </View>
            </View>
          ))}
        </View>
        {routine.notes ? (
          <T v="body" tone="secondary">
            {routine.notes}
          </T>
        ) : null}

        {!starter && (
          <Button
            label={confirmDelete ? 'Tap again to delete' : 'Delete routine'}
            kind="quiet"
            onPress={() => {
              if (!confirmDelete) {
                haptic.warn();
                setConfirmDelete(true);
                return;
              }
              repo.deleteRoutine(routine.id);
              actions.reload();
              showSnack({ message: `${routine.name} deleted` });
              router.back();
            }}
          />
        )}
      </ScrollView>
      <StatusShade />
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={strength ? 'Start workout' : 'Start stretch'}
          icon={<Icons.play size={16} color={p.onPrimary} />}
          disabled={routine.itemCount === 0}
          onPress={() => router.push({ pathname: strength ? '/strength/[id]' : '/stretch/[id]', params: { id: routine.id } })}
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  index: { width: 20, textAlign: 'center' },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
}));
