/**
 * Strength logger (spec §9, mockups Strength and WorkoutDone). Set rows prefill from last
 * time, with last time's numbers greyed beside them. Checking a set starts the rest
 * timer, which keeps time from timestamps and alerts at 0 even with the app in the
 * background. Finish shows the summary and offers to update the routine. An empty workout
 * (`/strength/new`) starts with no lifts and offers to save what was done as a routine.
 */
import {
  formatClock,
  formatWeight,
  localIsoDate,
  kgToUnit,
  type LiftRecordKind,
  type LoggedSet,
  prefillSets,
  type RoutineDetail,
  routineFromLog,
  type SetRow,
  type StrengthItem,
  unitToKg,
  volumeKg,
} from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, memo, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack, useUnits } from '@/data/store';
import { monthDay, thousands } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { NotFound } from '@/ui/NotFound';
import { RatingSlider, RPE_WORDS } from '@/ui/RatingSlider';
import { Sheet } from '@/ui/Sheet';
import { Button, IconButton, T } from '@/ui/primitives';
import { onExercisesPicked } from '@/features/library/pick';
import { setsSummary } from '@/features/library/ExerciseDetailScreen';
import { NumPad, PAD_HEIGHT, type PadKey, pressKey } from './NumPad';
import { cancelRest, startRest, useRest } from './rest';
import { StatusShade } from '@/ui/StatusShade';
import { type Bests, RecordRow, replaySets, Trophy, workoutRecords } from '@/features/records/records';

interface Row extends SetRow {
  done: boolean;
  completedAt?: string;
}

type Field = 'weight' | 'reps';

/** The cell the number pad edits, and its text so far. */
interface Pad {
  b: number;
  r: number;
  field: Field;
  buf: string;
  /** Just focused or stepped: the next digit replaces the value. */
  fresh: boolean;
}

interface Block {
  key: string;
  exerciseId: string;
  name: string;
  restS: number;
  rows: Row[];
}

function blocksFor(routine: RoutineDetail): Block[] {
  if (routine.items.kind !== 'strength') return [];
  const items = routine.items.items;
  const last = repo.lastSets(items.map((i) => i.exerciseId));
  return items.map((item, i) => ({
    key: `${item.exerciseId}-${i}`,
    exerciseId: item.exerciseId,
    name: repo.exercise(item.exerciseId)?.name ?? 'Exercise',
    restS: item.restS,
    rows: prefillSets(item, last[item.exerciseId] ?? []).map((r) => ({ ...r, done: false })),
  }));
}

/** The checked rows that beat a record, replayed in the order they were checked. */
function trophies(blocks: Block[], bests: Bests): Map<Row, LiftRecordKind[]> {
  const checked = blocks
    .flatMap((b) => b.rows.filter((r) => r.done).map((row) => ({ exerciseId: b.exerciseId, reps: row.reps, ...(row.weightKg !== undefined ? { weightKg: row.weightKg } : {}), row })))
    .sort((a, b) => a.row.completedAt!.localeCompare(b.row.completedAt!));
  return new Map([...replaySets(checked, bests).beaten].map(([set, kinds]) => [set.row, kinds]));
}

const unchecked = (blocks: Block[]) => blocks.reduce((n, b) => n + b.rows.filter((r) => !r.done).length, 0);

/** `/strength/new` is an empty workout: no routine, lifts added as you go. */
export const EMPTY_WORKOUT = 'new';
const EMPTY_NAME = 'Workout';
const DEFAULT_REST_S = 90;

export function StrengthScreen() {
  const { id, key } = useLocalSearchParams<{ id: string; key?: string }>();
  const [routine] = useState(() => (id === EMPTY_WORKOUT ? undefined : repo.routine(id)));
  if (id !== EMPTY_WORKOUT && (!routine || routine.items.kind !== 'strength')) return <NotFound message="Workout not found" />;
  return <Logger routine={routine} scheduleKey={key} />;
}

function Logger({ routine, scheduleKey }: { routine: RoutineDetail | undefined; scheduleKey?: string }) {
  const name = routine?.name ?? EMPTY_NAME;
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().weight;
  const [startedAt] = useState(() => new Date());
  const [blocks, setBlocks] = useState<Block[]>(() => (routine ? blocksFor(routine) : []));
  // Records from before this session; trophies are judged against them as sets are checked.
  const [bests, setBests] = useState<Bests>(() => (routine?.items.kind === 'strength' ? repo.liftBests(routine.items.items.map((i) => i.exerciseId)) : {}));
  const [pad, setPad] = useState<Pad>();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const winH = useWindowDimensions().height;
  const [swapping, setSwapping] = useState<number>();
  const [leaving, setLeaving] = useState(false);
  const [ending, setEnding] = useState(false);
  const [finished, setFinished] = useState<{ endedAt: Date; sets: LoggedSet[] }>();

  useEffect(() => cancelRest, []);
  // Back hides the pad first, then asks before throwing a workout away.
  const padOpen = pad !== undefined;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (finished) return false;
      if (padOpen) setPad(undefined);
      else setLeaving(true);
      return true;
    });
    return () => sub.remove();
  }, [finished, padOpen]);

  const doneSets = (bs: Block[]): (LoggedSet & { completedAt: string })[] =>
    bs.flatMap((b) =>
      b.rows
        .filter((r) => r.done)
        .map((r, setIdx) => ({ exerciseId: b.exerciseId, setIdx, reps: r.reps, ...(r.weightKg !== undefined ? { weightKg: r.weightKg } : {}), completedAt: r.completedAt! })),
    );

  const update = (b: number, fn: (block: Block) => Block) => setBlocks((cur) => cur.map((x, i) => (i === b ? fn(x) : x)));

  const toggle = (b: number, r: number) => {
    const block = blocks[b]!;
    const row = block.rows[r]!;
    const done = !row.done;
    const nextRow: Row = { ...row, done, completedAt: done ? new Date().toISOString() : undefined };
    const next = blocks.map((x, i) => (i === b ? { ...x, rows: x.rows.map((y, j) => (j === r ? nextRow : y)) } : x));
    setBlocks(next);
    if (done) {
      if (trophies(next, bests).has(nextRow)) haptic.record();
      else haptic.commit();
      if (block.restS > 0) startRest(block.restS, block.name);
    } else haptic.tick();
  };

  const addSet = (b: number) => {
    haptic.commit();
    update(b, (x) => {
      const last = x.rows.at(-1);
      return { ...x, rows: [...x.rows, { setIdx: x.rows.length, reps: last?.reps ?? 10, ...(last?.weightKg !== undefined ? { weightKg: last.weightKg } : {}), done: false }] };
    });
  };
  const removeSet = (b: number, r: number) => {
    haptic.commit();
    setPad(undefined);
    update(b, (x) => ({ ...x, rows: x.rows.filter((_, j) => j !== r).map((y, j) => ({ ...y, setIdx: j })) }));
  };

  const weightStep = unit === 'lb' ? 5 : 2.5;
  const weightText = (row: Row) => (row.weightKg ? String(Math.round(kgToUnit(row.weightKg, unit) * 10) / 10) : '');

  /** Opens the pad on a cell; with the cell's screen position, scrolls it clear of the pad. */
  const focus = (b: number, r: number, field: Field, pageY?: number) => {
    const row = blocks[b]?.rows[r];
    if (!row) return setPad(undefined);
    setPad({ b, r, field, buf: field === 'weight' ? weightText(row) : String(row.reps), fresh: true });
    const padTop = winH - PAD_HEIGHT - insets.bottom - 8;
    if (pageY !== undefined && pageY + 56 > padTop) scroll.current?.scrollTo({ y: scrollY.current + pageY + 72 - padTop, animated: true });
  };

  /** Writes the pad's number; a weight also fills the sets after it that are not checked yet. */
  const apply = (at: Pad, buf: string) => {
    const n = Number.parseFloat(buf) || 0;
    if (at.field === 'reps') return update(at.b, (x) => ({ ...x, rows: x.rows.map((y, j) => (j === at.r ? { ...y, reps: Math.round(n) } : y)) }));
    const weightKg = n > 0 ? unitToKg(n, unit) : undefined;
    update(at.b, (x) => ({ ...x, rows: x.rows.map((y, j) => (j === at.r || (j > at.r && !y.done) ? { ...y, weightKg } : y)) }));
  };

  const onKey = (k: PadKey) => {
    if (!pad) return;
    if (k.type === 'next') {
      // Weight, then reps, then the next set's weight; past the last set the pad closes.
      if (pad.field === 'weight') return focus(pad.b, pad.r, 'reps');
      if (pad.r + 1 < blocks[pad.b]!.rows.length) return focus(pad.b, pad.r + 1, 'weight');
      if (blocks[pad.b + 1]?.rows.length) return focus(pad.b + 1, 0, 'weight');
      return setPad(undefined);
    }
    const buf = pressKey(pad.buf, pad.fresh, k, pad.field === 'weight', pad.field === 'weight' ? weightStep : 1);
    if (buf === undefined) return;
    setPad({ ...pad, buf, fresh: k.type === 'step' });
    apply(pad, buf);
  };

  const pickExercises = (replace?: number) => {
    onExercisesPicked((picked) => {
      const last = repo.lastSets(picked.map((e) => e.id));
      const picks = repo.liftBests(picked.map((e) => e.id));
      setBests((cur) => ({ ...picks, ...cur }));
      const fresh = picked.map((e, i): Block => {
        const item: StrengthItem = { exerciseId: e.id, sets: 3, reps: 10, restS: routine?.items.kind === 'strength' ? routine.items.restS : DEFAULT_REST_S };
        return { key: `${e.id}-${Date.now()}-${i}`, exerciseId: e.id, name: e.name, restS: item.restS, rows: prefillSets(item, last[e.id] ?? []).map((r) => ({ ...r, done: false })) };
      });
      setBlocks((cur) => (replace === undefined ? [...cur, ...fresh] : cur.flatMap((x, i) => (i === replace ? fresh.slice(0, 1).map((f) => ({ ...f, restS: x.restS })) : [x]))));
    });
    router.push({ pathname: '/exercises', params: { pick: 'strength' } });
  };

  const finish = () => {
    const sets = doneSets(blocks);
    cancelRest();
    if (sets.length === 0) {
      setLeaving(true);
      return;
    }
    haptic.success();
    setFinished({ endedAt: new Date(), sets });
  };

  // Saved from the finish screen (Done or back), so Discard there can still drop it.
  const save = (feel: { rpe?: number; notes?: string }) => {
    if (!finished) return;
    const sets = doneSets(blocks);
    repo.saveStrengthSession({ name, ...(routine ? { routineId: routine.id } : {}), ...(scheduleKey ? { scheduleKey } : {}), startedAt: startedAt.toISOString(), endedAt: finished.endedAt.toISOString(), sets, ...feel });
    actions.reload();
  };

  if (finished) return <Finished routine={routine} name={name} startedAt={startedAt} endedAt={finished.endedAt} sets={finished.sets} blocks={blocks} bests={bests} onSave={save} />;
  const won = trophies(blocks, bests);

  return (
    <View style={s.screen}>
      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <IconButton label="Leave workout" size={40} onPress={() => setLeaving(true)}>
          <Icons.x size={20} color={p.text} />
        </IconButton>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <T v="labelStrong" numberOfLines={1}>
            {name}
          </T>
          <Elapsed since={startedAt} />
        </View>
        <Button
          label="Finish"
          size="sm"
          onPress={() => {
            setPad(undefined);
            if (doneSets(blocks).length === 0) setLeaving(true);
            else setEnding(true);
          }}
        />
      </View>
      <RestBanner />

      <ScrollView
        ref={scroll}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + (pad ? PAD_HEIGHT + 40 : 32) }]}
        showsVerticalScrollIndicator={false}
      >
        {blocks.map((block, b) => (
          <Animated.View key={block.key} layout={LinearTransition.duration(200)} style={s.card}>
            <View style={s.cardHead}>
              <T v="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                {block.name}
              </T>
              <IconButton label={`Swap ${block.name}`} size={32} bg="none" onPress={() => setSwapping(b)}>
                <Icons.swap size={18} color={p.textSecondary} />
              </IconButton>
            </View>
            <View style={s.headRow}>
              <T v="micro" tone="tertiary" style={s.colSet}>
                Set
              </T>
              <T v="micro" tone="tertiary" style={s.colPrev}>
                Previous
              </T>
              <T v="micro" tone="tertiary" style={s.colNum}>
                {unit}
              </T>
              <T v="micro" tone="tertiary" style={s.colNum}>
                Reps
              </T>
              <View style={s.colCheck} />
            </View>
            {block.rows.map((row, r) => (
              <SetLine
                key={r}
                row={row}
                record={won.has(row)}
                unit={unit}
                focused={pad && pad.b === b && pad.r === r ? pad.field : undefined}
                buf={pad && pad.b === b && pad.r === r ? pad.buf : undefined}
                onEdit={(field, pageY) => {
                  haptic.tap();
                  focus(b, r, field, pageY);
                }}
                onToggle={() => toggle(b, r)}
              />
            ))}
            <Pressable accessibilityRole="button" onPress={() => addSet(b)} style={({ pressed }) => [s.addSet, pressed && { opacity: 0.6 }]}>
              <Icons.plus size={14} color={p.textSecondary} />
              <T v="label" tone="secondary">
                Add set
              </T>
            </Pressable>
          </Animated.View>
        ))}
        <Button label="Add exercise" kind="outline" icon={<Icons.plus size={16} color={p.text} />} onPress={() => pickExercises()} />
      </ScrollView>

      {pad && (
        <NumPad
          title={`${blocks[pad.b]?.name ?? ''}, set ${pad.r + 1}, ${pad.field === 'weight' ? unit : 'reps'}`}
          step={pad.field === 'weight' ? weightStep : 1}
          decimals={pad.field === 'weight'}
          onKey={onKey}
          onRemove={() => removeSet(pad.b, pad.r)}
          onHide={() => setPad(undefined)}
        />
      )}

      <Sheet visible={swapping !== undefined} onClose={() => setSwapping(undefined)} title="Swap exercise">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            For this session only. The routine keeps its exercise.
          </T>
          <Button
            label="Pick a different exercise"
            onPress={() => {
              const b = swapping;
              setSwapping(undefined);
              pickExercises(b);
            }}
          />
          <Button
            label="Remove from this session"
            kind="quiet"
            onPress={() => {
              const b = swapping;
              setSwapping(undefined);
              haptic.commit();
              setBlocks((cur) => cur.filter((_, i) => i !== b));
            }}
          />
        </View>
      </Sheet>

      <Sheet visible={ending} onClose={() => setEnding(false)} title="Finish workout">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            {unchecked(blocks) > 0 ? `${unchecked(blocks)} ${unchecked(blocks) === 1 ? 'set is' : 'sets are'} not checked and will not be saved.` : 'Every set is checked.'}
          </T>
          <Button
            label="Finish workout"
            onPress={() => {
              setEnding(false);
              finish();
            }}
          />
          <Button label="Keep going" kind="outline" onPress={() => setEnding(false)} />
        </View>
      </Sheet>

      <Sheet visible={leaving} onClose={() => setLeaving(false)} title="Leave workout">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            {doneSets(blocks).length === 0 ? 'No sets are checked yet, so there is nothing to save.' : 'Finish saves the checked sets. Leaving throws them away.'}
          </T>
          {doneSets(blocks).length > 0 && (
            <Button
              label="Finish workout"
              onPress={() => {
                setLeaving(false);
                finish();
              }}
            />
          )}
          <Button label="Keep going" kind="outline" onPress={() => setLeaving(false)} />
          <Button
            label="Leave without saving"
            kind="quiet"
            onPress={() => {
              cancelRest();
              setLeaving(false);
              router.back();
            }}
          />
        </View>
      </Sheet>
    </View>
  );
}

const SetLine = memo(function SetLine({
  row,
  record,
  unit,
  focused,
  buf,
  onEdit,
  onToggle,
}: {
  row: Row;
  /** Checked and beat a record: a trophy between Previous and the weight. */
  record: boolean;
  unit: 'lb' | 'kg';
  /** The cell the number pad is editing, if it is on this row. */
  focused: Field | undefined;
  /** The pad's text while it edits this row, shown as typed ("12." keeps its point). */
  buf: string | undefined;
  onEdit: (field: Field, pageY: number) => void;
  onToggle: () => void;
}) {
  const s = useStyles();
  const p = usePalette();
  const prev = row.previous ? (row.previous.weightKg ? `${formatWeight(row.previous.weightKg, unit)} x ${row.previous.reps}` : `${row.previous.reps} reps`) : '-';
  const on = { borderWidth: 1.5, borderColor: p.primary, backgroundColor: p.surface };
  const weight = focused === 'weight' ? buf || '0' : row.weightKg ? String(Math.round(kgToUnit(row.weightKg, unit) * 10) / 10) : '-';
  const reps = focused === 'reps' ? buf || '0' : String(row.reps);
  return (
    <View style={[s.setRow, row.done && { backgroundColor: p.success + '1F' }]}>
      <T v="labelStrong" tone="secondary" style={s.colSet} num>
        {String(row.setIdx + 1)}
      </T>
      <View style={[s.colPrev, s.prevCell]}>
        <T v="label" tone="tertiary" num numberOfLines={1} style={{ flexShrink: 1 }}>
          {prev}
        </T>
        {record && (
          <Animated.View entering={FadeIn.duration(200)} accessible accessibilityLabel="New record">
            <Trophy size={18} />
          </Animated.View>
        )}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Weight, set ${row.setIdx + 1}`} accessibilityState={{ selected: focused === 'weight' }} onPress={(e) => onEdit('weight', e.nativeEvent.pageY)} style={[s.colNum, s.cell, focused === 'weight' && on]}>
        <T v="bodyStrong" num>
          {weight}
        </T>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Reps, set ${row.setIdx + 1}`} accessibilityState={{ selected: focused === 'reps' }} onPress={(e) => onEdit('reps', e.nativeEvent.pageY)} style={[s.colNum, s.cell, focused === 'reps' && on]}>
        <T v="bodyStrong" num>
          {reps}
        </T>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.done }}
        accessibilityLabel={`Set ${row.setIdx + 1} done`}
        hitSlop={6}
        onPress={onToggle}
        style={[s.colCheck, s.check, row.done && { backgroundColor: p.success, borderColor: p.success }]}
      >
        {row.done && <Icons.check size={16} color={p.onPrimary} />}
      </Pressable>
    </View>
  );
});

/** Workout clock: only this text re-renders each second. */
function Elapsed({ since }: { since: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <T v="micro" tone="secondary" num>
      {formatClock(Math.floor((now - since.getTime()) / 1000))}
    </T>
  );
}

/** Rest countdown under the top bar, with +30 s and skip. */
function RestBanner() {
  const s = useStyles();
  const p = usePalette();
  const endsAt = useRest((r) => r.endsAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={s.rest}>
      <T v="labelStrong" color={p.onPrimary}>
        Rest
      </T>
      <T v="title" num color={p.onPrimary} style={{ flex: 1 }}>
        {left === 0 ? 'Go' : formatClock(left)}
      </T>
      <Pressable accessibilityRole="button" accessibilityLabel="Add 30 seconds of rest" onPress={() => startRest(Math.max(0, (endsAt - Date.now()) / 1000) + 30)} style={s.restBtn}>
        <T v="labelStrong" color={p.onPrimary}>
          +30 s
        </T>
      </Pressable>
      <IconButton label="Skip rest" size={36} bg="none" onPress={cancelRest}>
        <Icons.x size={18} color={p.onPrimary} />
      </IconButton>
    </Animated.View>
  );
}

/**
 * Finish summary (mockup WorkoutDone), effort and a note, and "Update routine with these
 * values?". Nothing is saved until Done (or back); Discard drops the workout.
 */
function Finished({
  routine,
  name,
  startedAt,
  endedAt,
  sets,
  blocks,
  bests,
  onSave,
}: {
  routine: RoutineDetail | undefined;
  name: string;
  startedAt: Date;
  endedAt: Date;
  sets: LoggedSet[];
  blocks: Block[];
  bests: Bests;
  onSave: (feel: { rpe?: number; notes?: string }) => void;
}) {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const units = useUnits();
  const unit = units.weight;
  const [records] = useState(() => workoutRecords(sets, bests, localIsoDate(startedAt)));
  const [answered, setAnswered] = useState(false);
  const [rpe, setRpe] = useState<number>();
  const [notes, setNotes] = useState('');
  const [discarding, setDiscarding] = useState(false);

  const done = () => {
    onSave({ ...(rpe ? { rpe } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) });
    haptic.commit();
    router.back();
  };
  const discard = () => {
    setDiscarding(false);
    showSnack({ message: 'Workout discarded' });
    router.back();
  };
  // Back saves, the same as Done.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      done();
      return true;
    });
    return () => sub.remove();
  });
  // A routine's update from this log, or for an empty workout the lifts done as a new one.
  const suggestion = useMemo(() => {
    if (routine) return routine.items.kind === 'strength' ? routineFromLog(routine.items, sets) : undefined;
    const fresh = routineFromLog({ schemaVersion: 2, kind: 'strength', restS: DEFAULT_REST_S, items: blocks.map((b) => ({ exerciseId: b.exerciseId, sets: 0, reps: 0, restS: b.restS })) }, sets);
    return fresh?.kind === 'strength' ? { ...fresh, items: fresh.items.filter((i) => i.sets > 0) } : undefined;
  }, [routine, blocks, sets]);
  const [newName, setNewName] = useState(`${EMPTY_NAME}, ${monthDay(localIsoDate(startedAt))}`);
  const minutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
  const volume = volumeKg(sets);
  const starter = routine?.origin === 'starter';

  const apply = () => {
    if (!suggestion) return;
    if (!routine) {
      repo.createRoutine({ name: newName.trim() || EMPTY_NAME, items: suggestion });
      showSnack({ message: 'Saved to your routines' });
    } else if (routine.origin === 'starter') {
      const copy = repo.duplicateRoutine(routine.id, `${routine.name} (mine)`);
      repo.updateRoutine(copy, { name: `${routine.name} (mine)`, items: suggestion });
    } else repo.updateRoutine(routine.id, { name: routine.name, items: suggestion, ...(routine.notes ? { notes: routine.notes } : {}) });
    actions.reload();
    haptic.success();
    setAnswered(true);
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 24 }]} showsVerticalScrollIndicator={false}>
        <T v="caption" tone="secondary">
          Workout finished
        </T>
        <T v="display" accessibilityRole="header">
          {name}
        </T>
        <View style={s.stats}>
          <Stat value={`${minutes} min`} label="Duration" />
          <Stat value={String(sets.length)} label="Sets" />
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
        <View style={s.card}>
          {blocks
            .filter((b) => b.rows.some((r) => r.done))
            .map((b, i) => (
              <View key={b.key} style={[s.doneRow, i > 0 && s.divider]}>
                <T v="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>
                  {b.name}
                </T>
                <T v="label" tone="secondary" num>
                  {setsSummary(
                    sets.filter((x) => x.exerciseId === b.exerciseId),
                    unit,
                  )}
                </T>
              </View>
            ))}
        </View>
        {suggestion && !answered && (
          <Animated.View entering={FadeIn.duration(200)} style={[s.card, { paddingVertical: 14, gap: 10 }]}>
            {routine ? (
              <>
                <T v="bodyStrong">{starter ? `Save these weights as your own ${routine.name}?` : `Update ${routine.name} with these values?`}</T>
                <T v="caption" tone="secondary">
                  {starter ? 'Starter routines are read-only, so this makes a copy. Next time starts from the new numbers.' : 'Next time starts from the new numbers.'}
                </T>
              </>
            ) : (
              <>
                <T v="bodyStrong">Save as a routine?</T>
                <TextInput value={newName} onChangeText={setNewName} accessibilityLabel="Routine name" placeholderTextColor={p.textTertiary} style={s.nameInput} />
              </>
            )}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label={routine ? 'Keep as is' : 'Not now'} kind="outline" size="md" style={{ flex: 1 }} onPress={() => setAnswered(true)} />
              <Button label={!routine ? 'Save routine' : starter ? 'Save a copy' : 'Update'} size="md" style={{ flex: 1 }} onPress={apply} />
            </View>
          </Animated.View>
        )}
        <View style={[s.card, { paddingVertical: 14, gap: 12 }]}>
          <T v="headline">How hard was it</T>
          <RatingSlider value={rpe} words={RPE_WORDS} label="Effort, 1 to 10" prompt="Tap or slide to rate" ends={['1 very easy', '10 all out']} onChange={setRpe} />
          <TextInput value={notes} onChangeText={setNotes} placeholder="Note, optional" placeholderTextColor={p.textTertiary} accessibilityLabel="Note" multiline style={s.note} />
        </View>
        <Button label="Discard workout" kind="quiet" onPress={() => setDiscarding(true)} />
      </ScrollView>
      <StatusShade />
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Done" onPress={done} />
      </View>
      <Sheet visible={discarding} onClose={() => setDiscarding(false)} title="Discard workout">
        <View style={{ gap: 10 }}>
          <T v="body" tone="secondary">
            {routine ? 'The sets are not saved, and the workout stays due.' : 'The sets are not saved.'}
          </T>
          <Button label="Discard workout" onPress={discard} />
          <Button label="Keep it" kind="outline" onPress={() => setDiscarding(false)} />
        </View>
      </Sheet>
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
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 12, paddingBottom: 4 },
  cardHead: { flexDirection: 'row', alignItems: 'center', paddingTop: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  setRow: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 10 },
  colSet: { width: 36, textAlign: 'center' },
  colPrev: { flex: 1 },
  prevCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingRight: 4 },
  colNum: { width: 72, alignItems: 'center', textAlign: 'center' },
  colCheck: { width: 44, alignItems: 'center' },
  cell: { height: 38, justifyContent: 'center', borderRadius: 10, backgroundColor: p.inset, marginHorizontal: 4 },
  check: { width: 32, height: 32, borderRadius: 10, borderWidth: 1.5, borderColor: p.dashed, justifyContent: 'center', marginLeft: 6 },
  addSet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40 },
  rest: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, paddingLeft: 16, paddingRight: 6, height: 56, borderRadius: 16, backgroundColor: p.primary },
  restBtn: { height: 36, paddingHorizontal: 12, borderRadius: 12, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  stats: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  nameInput: { height: 44, borderRadius: 12, backgroundColor: p.inset, paddingHorizontal: 12, color: p.text, fontFamily: 'Inter', fontSize: 15 },
  note: { minHeight: 72, borderRadius: 12, backgroundColor: p.inset, padding: 12, color: p.text, fontFamily: 'Inter', fontSize: 15, textAlignVertical: 'top' },
}));
