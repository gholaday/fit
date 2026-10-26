/**
 * Run workout builder (spec §4 Builder UX, §14). Edits a WorkoutItem[] in local state:
 * quick-add chips, tap a step to edit it in place, drag the grip to reorder, swipe left to
 * delete, long-press to duplicate. One level of repeats. The header shows the structure
 * bar and the estimated time and distance as you edit; validation runs on every change and
 * blocks Save. "Text" swaps the list for the quick text form, which round-trips.
 * Opened with `?id=` to edit a library workout, or with nothing for a new one.
 */
import {
  type BuilderChip,
  DslError,
  type RepeatBlock,
  type SessionMode,
  type Step,
  type WorkoutItem,
  duplicateItem,
  formatDistance,
  formatMinutes,
  formatWorkout,
  isRepeat,
  itemFromChip,
  parseWorkout,
  structureSegments,
  totalMeters,
  totalSeconds,
  validateItems,
} from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
// The gesture-handler ScrollView, so a drag on a grip wins over scrolling.
import { ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { newId, repo } from '@/data';
import { actions, showSnack, useSettings } from '@/data/store';
import { stepName, stepTone } from '@/features/run/steps';
import { haptic } from '@/lib/haptics';
import { createStyles, toneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { Button, Chip, IconButton, NumStepper, Segmented, StructureBar, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { CARD_GAP, DragCard, useDragState } from './DragCard';
import { paceLookup, stepLine } from './describe';
import { type EditorOpts, StepEditor } from './StepEditor';

const CHIPS: readonly { chip: BuilderChip; label: string }[] = [
  { chip: 'warmup', label: 'Warm up' },
  { chip: 'run', label: 'Run' },
  { chip: 'walk', label: 'Walk' },
  { chip: 'sprint', label: 'Sprint' },
  { chip: 'repeat', label: 'Repeat' },
  { chip: 'cooldown', label: 'Cool down' },
];
const MODES: readonly { value: SessionMode; label: string }[] = [
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'timer', label: 'Timer' },
];

export function BuilderScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const unit = settings.units.distance;
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [existing] = useState(() => (id ? repo.workout(id) : undefined));
  const [vdot] = useState(() => repo.currentVdot());
  const [name, setName] = useState(existing?.name ?? 'Run workout');
  const [mode, setMode] = useState<SessionMode>(existing?.defaultMode ?? 'outdoor');
  const [items, setItems] = useState<WorkoutItem[]>(() => existing?.items ?? [itemFromChip('warmup', newId, settings), itemFromChip('run', newId, settings), itemFromChip('cooldown', newId, settings)]);
  const [open, setOpen] = useState<string>();
  const [text, setText] = useState<string>();
  const [textError, setTextError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const drag = useDragState();

  const opts: EditorOpts = { mode, unit, easyBy: settings.easyBy, vdot };
  const pace = paceLookup(vdot);
  const issues = validateItems(items);
  const seconds = totalSeconds(items, pace);
  const meters = totalMeters(items, pace);
  const canSave = name.trim() !== '' && issues.length === 0 && text === undefined;

  const edit = (next: WorkoutItem[]) => {
    setItems(next);
    setDirty(true);
  };
  const add = (chip: BuilderChip) => {
    const item = itemFromChip(chip, newId, settings);
    edit([...items, item]);
    setOpen(isRepeat(item) ? undefined : item.id);
  };
  const replace = (i: number, item: WorkoutItem) => edit(items.map((it, j) => (j === i ? item : it)));
  const remove = (i: number) => {
    const before = items;
    haptic.commit();
    edit(items.filter((_, j) => j !== i));
    showSnack({ message: 'Step deleted', actionLabel: 'Undo', onAction: () => setItems(before) });
  };
  const duplicate = (i: number) => {
    haptic.commit();
    edit([...items.slice(0, i + 1), duplicateItem(items[i]!, newId), ...items.slice(i + 1)]);
    showSnack({ message: 'Step duplicated' });
  };
  const move = (from: number, to: number) => {
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it!);
    haptic.commit();
    edit(next);
  };

  const showText = () => {
    haptic.tick();
    if (text !== undefined) {
      setText(undefined);
      setTextError(undefined);
      return;
    }
    setText(formatWorkout(items, unit));
    setOpen(undefined);
  };
  const applyText = () => {
    try {
      const parsed = parseWorkout(text ?? '', newId);
      edit(parsed);
      setText(undefined);
      setTextError(undefined);
      haptic.success();
    } catch (e) {
      setTextError(e instanceof DslError ? e.message : 'Could not read that workout');
    }
  };

  const save = () => {
    if (!canSave) return;
    const savedId = repo.saveWorkout({ name: name.trim(), items, defaultMode: mode, template: true }, existing?.id);
    actions.reload();
    haptic.success();
    showSnack({ message: existing ? 'Workout saved' : `${name.trim()} added to your library` });
    if (existing) router.back();
    else router.replace({ pathname: '/workout/[id]', params: { id: savedId } });
  };
  const startNow = () => {
    if (!canSave) return;
    // A one-off copy that stays out of the library.
    const oneOff = repo.saveWorkout({ name: name.trim(), items, defaultMode: mode, template: false });
    haptic.commit();
    router.replace({ pathname: '/run', params: { workoutId: oneOff } });
  };
  const close = () => {
    if (dirty) setLeaving(true);
    else router.back();
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Close" size={40} onPress={close}>
            <Icons.x size={20} color={p.text} />
          </IconButton>
          <T v="headline" style={{ flex: 1 }}>
            {existing ? 'Edit run workout' : 'New run workout'}
          </T>
          <Button label={text === undefined ? 'Text' : 'Steps'} kind="outline" size="sm" style={{ borderRadius: 18 }} onPress={showText} />
        </View>

        <TextInput value={name} onChangeText={(v) => (setName(v), setDirty(true))} placeholder="Name" placeholderTextColor={p.textTertiary} accessibilityLabel="Workout name" style={s.name} selectTextOnFocus />
        <Segmented options={MODES} value={mode} onChange={(m) => (setMode(m), setDirty(true))} />

        <View style={s.summary}>
          <StructureBar segments={structureSegments(items, pace)} height={10} />
          <T v="label" tone="secondary" num>
            {meters > 0 ? `${formatMinutes(seconds)}, about ${formatDistance(meters, unit)}` : formatMinutes(seconds)}
          </T>
        </View>

        {text !== undefined ? (
          <View style={{ gap: 10 }}>
            <TextInput
              value={text}
              onChangeText={(v) => (setText(v), setTextError(undefined))}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Workout as text"
              placeholder="10min easy, 4x [ 30s sprint, 90s walk ], 5min walk"
              placeholderTextColor={p.textTertiary}
              style={s.text}
            />
            {textError && (
              <T v="caption" color={p.sprint.color}>
                {textError}
              </T>
            )}
            <T v="caption" tone="tertiary">
              Steps separated by commas. Repeats as 4x [ ... ]. Targets after @, such as @ Z2, @ RPE 8 or @ 8:30-9:00 /mi.
            </T>
            <Button label="Apply" size="md" disabled={text.trim() === ''} onPress={applyText} />
          </View>
        ) : (
          <>
            <View style={{ gap: CARD_GAP }}>
              {items.map((it, i) => (
                <DragCard key={it.id} index={i} drag={drag} label={isRepeat(it) ? 'repeat' : stepName(it)} onMove={move} onDelete={() => remove(i)}>
                  {isRepeat(it) ? (
                    <RepeatCard block={it} open={open} setOpen={setOpen} opts={opts} issues={issues.filter((x) => x.item === i).map((x) => ({ step: x.step, message: x.message }))} onChange={(b) => replace(i, b)} onDuplicate={() => duplicate(i)} />
                  ) : (
                    <StepRow step={it} open={open === it.id} onToggle={() => setOpen(open === it.id ? undefined : it.id)} onLongPress={() => duplicate(i)} opts={opts} issues={issues.filter((x) => x.item === i).map((x) => x.message)} onChange={(st) => replace(i, st)} />
                  )}
                </DragCard>
              ))}
            </View>
            {items.length === 0 && (
              <T v="caption" tone="tertiary" align="center">
                Add steps with the buttons below.
              </T>
            )}
            <View style={s.chips}>
              {CHIPS.map((c) => (
                <AddChip key={c.chip} label={c.label} onPress={() => add(c.chip)} />
              ))}
            </View>
            <T v="caption" tone="tertiary">
              Drag the handle to reorder. Swipe left to delete. Press and hold to duplicate.
            </T>
          </>
        )}
      </ScrollView>
      <StatusShade />
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Start now" kind="outline" style={{ flex: 1 }} disabled={!canSave} onPress={startNow} />
        <Button label={existing ? 'Save' : 'Save to library'} style={{ flex: 1.4 }} disabled={!canSave} onPress={save} />
      </View>

      <Sheet visible={leaving} onClose={() => setLeaving(false)} title="Discard changes?">
        <View style={{ gap: 8 }}>
          <Button
            label="Discard"
            onPress={() => {
              setLeaving(false);
              router.back();
            }}
          />
          <Button label="Keep editing" kind="outline" onPress={() => setLeaving(false)} />
        </View>
      </Sheet>
    </View>
  );
}

function AddChip({ label, onPress }: { label: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add ${label.toLowerCase()}`}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: p.border, opacity: pressed ? 0.7 : 1 })}
    >
      <Icons.plus size={14} color={p.text} />
      <T v="label">{label}</T>
    </Pressable>
  );
}

function StepRow({ step, open, onToggle, onLongPress, opts, issues, onChange, onRemove }: { step: Step; open: boolean; onToggle: () => void; onLongPress?: () => void; opts: EditorOpts; issues: readonly string[]; onChange: (s: Step) => void; onRemove?: () => void }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <View style={{ paddingRight: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityHint="Opens the step. Press and hold to duplicate"
        onPress={() => {
          haptic.tick();
          onToggle();
        }}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={s.row}
      >
        <View style={[s.dot, { backgroundColor: toneColor(p, stepTone(step)) }]} />
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">{stepName(step)}</T>
          <T v="caption" tone="secondary" num>
            {stepLine(step, opts.unit, opts.vdot)}
          </T>
        </View>
        {onRemove && (
          <IconButton label={`Remove ${stepName(step)}`} size={32} bg="none" onPress={onRemove}>
            <Icons.x size={16} color={p.textSecondary} />
          </IconButton>
        )}
        {open ? <Icons.chevronUp size={18} color={p.textTertiary} /> : <Icons.chevronDown size={18} color={p.textTertiary} />}
      </Pressable>
      {issues.map((m) => (
        <T key={m} v="caption" color={p.sprint.color} style={{ paddingBottom: 6 }}>
          {m}
        </T>
      ))}
      {open && <StepEditor step={step} onChange={onChange} opts={opts} />}
    </View>
  );
}

function RepeatCard({ block, open, setOpen, opts, issues, onChange, onDuplicate }: { block: RepeatBlock; open: string | undefined; setOpen: (id: string | undefined) => void; opts: EditorOpts; issues: readonly { step?: number; message: string }[]; onChange: (b: RepeatBlock) => void; onDuplicate: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const setStep = (j: number, st: Step) => onChange({ ...block, steps: block.steps.map((x, k) => (k === j ? st : x)) });
  const addStep = (chip: 'run' | 'walk' | 'sprint') => {
    const st = itemFromChip(chip, newId, opts) as Step;
    onChange({ ...block, steps: [...block.steps, st] });
    setOpen(st.id);
  };
  return (
    <View style={{ paddingRight: 12, paddingBottom: 10 }}>
      <Pressable accessibilityHint="Press and hold to duplicate the repeat" onLongPress={onDuplicate} delayLongPress={350} style={s.row}>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong">Repeat</T>
          <T v="caption" tone="secondary">{`${block.steps.length} ${block.steps.length === 1 ? 'step' : 'steps'}, ${block.repeat} times`}</T>
        </View>
        <NumStepper label="Repeats" value={block.repeat} min={1} max={30} width={52} format={(n) => `${n}x`} onChange={(repeat) => onChange({ ...block, repeat })} />
      </Pressable>
      {issues
        .filter((x) => x.step === undefined)
        .map((x) => (
          <T key={x.message} v="caption" color={p.sprint.color} style={{ paddingBottom: 6 }}>
            {x.message}
          </T>
        ))}
      <View style={s.nested}>
        {block.steps.map((st, j) => (
          <View key={st.id} style={j > 0 && s.nestedDivider}>
            <StepRow
              step={st}
              open={open === st.id}
              onToggle={() => setOpen(open === st.id ? undefined : st.id)}
              opts={opts}
              issues={issues.filter((x) => x.step === j).map((x) => x.message)}
              onChange={(next) => setStep(j, next)}
              onRemove={block.steps.length > 1 ? () => (haptic.commit(), onChange({ ...block, steps: block.steps.filter((_, k) => k !== j) })) : undefined}
            />
          </View>
        ))}
      </View>
      <View style={[s.chips, { paddingTop: 8 }]}>
        <Chip label="Add run" on={false} onPress={() => addStep('run')} />
        <Chip label="Add walk" on={false} onPress={() => addStep('walk')} />
        <Chip label="Add sprint" on={false} onPress={() => addStep('sprint')} />
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { height: 48, borderRadius: 12, backgroundColor: p.surface, paddingHorizontal: 14, color: p.text, fontFamily: 'Inter', fontSize: 17, fontWeight: '600' },
  summary: { gap: 8, paddingHorizontal: 2 },
  text: { minHeight: 120, borderRadius: 12, backgroundColor: p.surface, padding: 14, color: p.text, fontFamily: 'Inter', fontSize: 15, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  nested: { borderRadius: 12, backgroundColor: p.inset, paddingLeft: 12 },
  nestedDivider: { borderTopWidth: 1, borderTopColor: p.divider },
  footer: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 8 },
}));
