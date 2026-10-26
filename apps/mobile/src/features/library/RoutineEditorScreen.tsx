/**
 * Routine editor. Strength: search and add exercises, then sets, reps, weight and rest.
 * Stretch: moves with hold and sides, plus the transition between moves. Every number is
 * a stepper. Opened with `?id=` to edit, or `?kind=` for a new routine.
 */
import { type ExerciseSummary, kgToUnit, ROUTINE_ITEMS_SCHEMA_VERSION, type RoutineItems, type StrengthItem, type StretchItem, unitToKg } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Group, IconButton, NumStepper, Row, Segmented, T } from '@/ui/primitives';
import { onExercisesPicked } from './pick';

const DEFAULT_REST_S = 90;

function blank(kind: 'strength' | 'stretch'): RoutineItems {
  return kind === 'strength' ? { schemaVersion: ROUTINE_ITEMS_SCHEMA_VERSION, kind, restS: DEFAULT_REST_S, items: [] } : { schemaVersion: ROUTINE_ITEMS_SCHEMA_VERSION, kind, transitionS: 10, items: [] };
}

export function RoutineEditorScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().weight;
  const params = useLocalSearchParams<{ id?: string; kind?: 'strength' | 'stretch' }>();
  const [existing] = useState(() => (params.id ? repo.routine(params.id) : undefined));
  const kind = existing?.kind ?? params.kind ?? 'strength';
  const [name, setName] = useState(existing?.name ?? (kind === 'strength' ? 'New workout' : 'New stretch'));
  const [routine, setRoutine] = useState<RoutineItems>(existing?.items ?? blank(kind));
  const [names, setNames] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const it of existing?.items.items ?? []) out[it.exerciseId] = repo.exercise(it.exerciseId)?.name ?? 'Missing exercise';
    return out;
  });

  const add = () => {
    onExercisesPicked((picked: ExerciseSummary[]) => {
      setNames((cur) => ({ ...cur, ...Object.fromEntries(picked.map((e) => [e.id, e.name])) }));
      setRoutine((cur) =>
        cur.kind === 'strength'
          ? { ...cur, items: [...cur.items, ...picked.map((e): StrengthItem => ({ exerciseId: e.id, sets: 3, reps: 10, restS: cur.restS }))] }
          : { ...cur, items: [...cur.items, ...picked.map((e): StretchItem => ({ exerciseId: e.id, holdS: e.defaultHoldS ?? 30, sides: e.sides }))] },
      );
    });
    router.push({ pathname: '/exercises', params: { pick: kind } });
  };

  const patch = (i: number, change: Partial<StrengthItem> | Partial<StretchItem>) =>
    setRoutine((cur) => ({ ...cur, items: cur.items.map((it, j) => (j === i ? { ...it, ...change } : it)) }) as RoutineItems);
  const remove = (i: number) => {
    haptic.commit();
    setRoutine((cur) => ({ ...cur, items: cur.items.filter((_, j) => j !== i) }) as RoutineItems);
  };
  const move = (i: number, d: -1 | 1) => {
    haptic.tick();
    setRoutine((cur) => {
      const items = [...cur.items];
      const j = i + d;
      if (j < 0 || j >= items.length) return cur;
      [items[i], items[j]] = [items[j]!, items[i]!];
      return { ...cur, items } as RoutineItems;
    });
  };

  const save = () => {
    const input = { name: name.trim(), items: routine };
    let id = existing?.id;
    if (existing) repo.updateRoutine(existing.id, input);
    else id = repo.createRoutine(input);
    actions.reload();
    haptic.success();
    showSnack({ message: existing ? 'Routine saved' : `${input.name} created` });
    if (existing) router.back();
    else router.replace({ pathname: '/routine/[id]', params: { id: id! } });
  };

  const weightStep = unit === 'lb' ? 5 : 2.5;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Close without saving" size={40} onPress={() => router.back()}>
            <Icons.x size={20} color={p.text} />
          </IconButton>
          <T v="headline">{existing ? 'Edit routine' : kind === 'strength' ? 'New workout' : 'New stretch routine'}</T>
        </View>
        <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={p.textTertiary} accessibilityLabel="Routine name" style={s.input} selectTextOnFocus />

        <Group>
          {routine.kind === 'strength' ? (
            <Row label="Default rest" sub="For exercises you add" last>
              <NumStepper label="Default rest" value={routine.restS} min={15} max={300} step={15} format={(n) => `${n} s`} onChange={(restS) => setRoutine({ ...routine, restS })} />
            </Row>
          ) : (
            <Row label="Between moves" sub="Time to get into the next one" last>
              <NumStepper label="Time between moves" value={routine.transitionS} min={0} max={30} step={5} format={(n) => `${n} s`} onChange={(transitionS) => setRoutine({ ...routine, transitionS })} />
            </Row>
          )}
        </Group>

        {routine.items.map((item, i) => (
          <View key={`${item.exerciseId}-${i}`} style={s.card}>
            <View style={s.cardHead}>
              <T v="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {names[item.exerciseId] ?? 'Exercise'}
              </T>
              <IconButton label="Move up" size={32} bg="none" disabled={i === 0} style={{ opacity: i === 0 ? 0.3 : 1 }} onPress={() => move(i, -1)}>
                <Icons.chevronUp size={16} color={p.text} />
              </IconButton>
              <IconButton label="Move down" size={32} bg="none" disabled={i === routine.items.length - 1} style={{ opacity: i === routine.items.length - 1 ? 0.3 : 1 }} onPress={() => move(i, 1)}>
                <Icons.chevronDown size={16} color={p.text} />
              </IconButton>
              <IconButton label={`Remove ${names[item.exerciseId] ?? 'exercise'}`} size={32} bg="none" onPress={() => remove(i)}>
                <Icons.trash size={16} color={p.textSecondary} />
              </IconButton>
            </View>
            {'sets' in item ? (
              <>
                <Line label="Sets">
                  <NumStepper label="Sets" value={item.sets} min={1} max={10} onChange={(sets) => patch(i, { sets })} />
                </Line>
                <Line label="Reps">
                  <NumStepper label="Reps" value={item.reps} min={1} max={50} onChange={(reps) => patch(i, { reps })} />
                </Line>
                <Line label="Weight">
                  <NumStepper
                    label="Weight"
                    value={item.weightKg ? Math.round(kgToUnit(item.weightKg, unit) / weightStep) * weightStep : 0}
                    min={0}
                    max={unit === 'lb' ? 700 : 320}
                    step={weightStep}
                    format={(n) => (n === 0 ? 'None' : `${n} ${unit}`)}
                    onChange={(n) => patch(i, { weightKg: n === 0 ? undefined : unitToKg(n, unit) })}
                  />
                </Line>
                <Line label="Rest" last>
                  <NumStepper label="Rest" value={item.restS} min={0} max={300} step={15} format={(n) => `${n} s`} onChange={(restS) => patch(i, { restS })} />
                </Line>
              </>
            ) : (
              <>
                <Line label="Hold">
                  <NumStepper label="Hold" value={item.holdS} min={10} max={180} step={5} format={(n) => `${n} s`} onChange={(holdS) => patch(i, { holdS })} />
                </Line>
                <Line label="Sides" last>
                  <View style={{ width: 160 }}>
                    <Segmented
                      look="inset"
                      options={[
                        { value: 'both', label: 'Both' },
                        { value: 'none', label: 'One' },
                      ]}
                      value={item.sides}
                      onChange={(sides) => patch(i, { sides })}
                    />
                  </View>
                </Line>
              </>
            )}
          </View>
        ))}

        <Button label={kind === 'strength' ? 'Add exercises' : 'Add moves'} kind="outline" icon={<Icons.plus size={16} color={p.text} />} onPress={add} />
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Save" disabled={name.trim() === '' || routine.items.length === 0} onPress={save} />
      </View>
    </View>
  );
}

function Line({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.line, !last && s.lineDivider]}>
      <T v="label" tone="secondary">
        {label}
      </T>
      {children}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { height: 48, borderRadius: 12, backgroundColor: p.surface, paddingHorizontal: 14, color: p.text, fontFamily: 'Inter', fontSize: 17, fontWeight: '600' },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14, paddingBottom: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: 8, paddingBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  lineDivider: { borderBottomWidth: 1, borderBottomColor: p.divider },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
}));
