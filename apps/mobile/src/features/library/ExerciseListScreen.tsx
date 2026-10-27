/**
 * Exercise catalog: word-start search ("rdl" finds Romanian deadlift), filters by kind,
 * muscle and equipment, FlashList with fixed-height rows. With `?pick=strength|stretch`
 * it selects several exercises for the routine editor.
 */
import { type Equipment, EQUIPMENT, type ExerciseKind, type ExerciseSummary, type Muscle, MUSCLES } from '@fit/core';
import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { useFocusedDataVersion } from '@/lib/focusedVersion';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Chip, IconButton, T } from '@/ui/primitives';
import { ExerciseRow } from './ExerciseRow';
import { EQUIPMENT_LABEL, KIND_LABEL, MUSCLE_LABEL } from './labels';
import { deliverPicked } from './pick';

const KINDS: readonly ExerciseKind[] = ['strength', 'stretch', 'cardio', 'plyometric'];

export function ExerciseListScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { pick } = useLocalSearchParams<{ pick?: 'strength' | 'stretch' }>();
  // Under an exercise's detail, edits are picked up when the list is shown again.
  const version = useFocusedDataVersion();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ExerciseKind | undefined>(pick);
  const [muscle, setMuscle] = useState<Muscle>();
  const [equipment, setEquipment] = useState<Equipment>();
  const [picked, setPicked] = useState<ExerciseSummary[]>([]);
  const q = useDeferredValue(query.trim());

  const list = useMemo(() => repo.exercises({ kind, muscle, equipment, query: q || undefined }), [kind, muscle, equipment, q, version]);

  const toggle = useCallback((e: ExerciseSummary) => setPicked((cur) => (cur.some((x) => x.id === e.id) ? cur.filter((x) => x.id !== e.id) : [...cur, e])), []);
  const open = useCallback((e: ExerciseSummary) => router.push({ pathname: '/exercise/[id]', params: { id: e.id } }), []);

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.top}>
        <IconButton label="Back" size={40} onPress={() => router.back()}>
          <Icons.chevronLeft size={20} color={p.text} />
        </IconButton>
        <T v="headline" style={{ flex: 1 }}>
          {pick ? 'Add exercises' : 'Exercises'}
        </T>
        {!pick && (
          <IconButton label="New exercise" size={40} onPress={() => router.push('/exercise/new')}>
            <Icons.plus size={20} color={p.text} />
          </IconButton>
        )}
      </View>

      <View style={s.search}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search exercises" placeholderTextColor={p.textTertiary} accessibilityLabel="Search exercises" style={s.searchInput} autoFocus={!!pick} />
        {query !== '' && (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}>
            <Icons.x size={16} color={p.textSecondary} />
          </Pressable>
        )}
      </View>

      <FilterRow>
        {KINDS.map((k) => (
          <Chip key={k} label={KIND_LABEL[k]} on={kind === k} onPress={() => setKind(kind === k ? undefined : k)} />
        ))}
      </FilterRow>
      <FilterRow>
        {MUSCLES.map((m) => (
          <Chip key={m} label={MUSCLE_LABEL[m]} on={muscle === m} onPress={() => setMuscle(muscle === m ? undefined : m)} />
        ))}
      </FilterRow>
      <FilterRow>
        {EQUIPMENT.map((e) => (
          <Chip key={e} label={EQUIPMENT_LABEL[e]} on={equipment === e} onPress={() => setEquipment(equipment === e ? undefined : e)} />
        ))}
      </FilterRow>

      <FlashList
        data={list}
        keyExtractor={(e) => e.id}
        extraData={picked}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: insets.bottom + (pick ? 96 : 24) }}
        renderItem={({ item }) => (pick ? <ExerciseRow exercise={item} selected={picked.some((x) => x.id === item.id)} onPress={() => toggle(item)} /> : <ExerciseRow exercise={item} onPress={() => open(item)} />)}
        ListEmptyComponent={
          <T v="body" tone="secondary" align="center" style={{ paddingTop: 32 }}>
            No exercises match
          </T>
        }
      />

      {pick && (
        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          <Button
            label={picked.length === 0 ? 'Pick exercises' : `Add ${picked.length}`}
            disabled={picked.length === 0}
            onPress={() => {
              deliverPicked(picked);
              router.back();
            }}
          />
        </View>
      )}
    </View>
  );
}

function FilterRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }} style={{ flexGrow: 0, marginBottom: 6 }}>
      {children}
    </ScrollView>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  search: { height: 44, marginHorizontal: 20, marginBottom: 10, borderRadius: 12, backgroundColor: p.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: p.text, fontFamily: 'Inter', fontSize: 15, paddingVertical: 0 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: p.bg },
}));
