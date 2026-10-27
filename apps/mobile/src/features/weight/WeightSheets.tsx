/**
 * Weight sheets (spec §12 Weight): the weigh-in sheet (one number, steppers of 0.1, Save)
 * and the goal setup sheet (start, target, pace, with the expected date as you change them).
 * Numbers are typed and stepped in the display unit and saved in kg.
 */
import { type IsoDate, type WeightUnit, allowedPaces, expectedGoalDate, kgToUnit, unitToKg } from '@fit/core';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { repo } from '@/data';
import { actions, showSnack, useToday, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { longDate } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { FONT } from '@/theme/type';
import { Button, Segmented, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { paceLabel } from './format';

/** Weights outside this range (in kg) are typing mistakes. */
const MIN_KG = 20;
const MAX_KG = 400;

const round1 = (n: number) => Math.round(n * 10) / 10;
const parse = (text: string) => Number.parseFloat(text.replace(',', '.'));

/** A weight to type, with minus and plus buttons of `step` either side. */
function WeightField({ text, onText, unit, label, step = 0.1 }: { text: string; onText: (t: string) => void; unit: WeightUnit; label: string; step?: number }) {
  const s = useStyles();
  const p = usePalette();
  const bump = (d: number) => {
    const v = parse(text);
    if (!Number.isFinite(v)) return;
    haptic.tick();
    onText(round1(v + d).toFixed(1));
  };
  return (
    <View style={s.field}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Lower ${label.toLowerCase()}`} onPress={() => bump(-step)} style={({ pressed }) => [s.step, pressed && { opacity: 0.6 }]}>
        <T v="headline">-</T>
      </Pressable>
      <View style={s.valueWrap}>
        <TextInput value={text} onChangeText={onText} keyboardType="decimal-pad" selectTextOnFocus accessibilityLabel={`${label} in ${unit}`} style={[s.value, { color: p.text }]} />
        <T v="bodyMedium" tone="secondary">
          {unit}
        </T>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Raise ${label.toLowerCase()}`} onPress={() => bump(step)} style={({ pressed }) => [s.step, pressed && { opacity: 0.6 }]}>
        <T v="headline">+</T>
      </Pressable>
    </View>
  );
}

/** The typed value in kg, or undefined when it is not a weight. */
function toKg(text: string, unit: WeightUnit): number | undefined {
  const v = parse(text);
  if (!Number.isFinite(v)) return undefined;
  const kg = unitToKg(v, unit);
  return kg >= MIN_KG && kg <= MAX_KG ? kg : undefined;
}

/**
 * Weigh in now, or edit a manual weigh-in when `editing` is given. Prefilled with the
 * weigh-in being edited, else the last one.
 */
export function WeighInSheet({ visible, onClose, editing }: { visible: boolean; onClose: () => void; editing?: { id: string; kg: number } }) {
  const p = usePalette();
  const unit = useUnits().weight;
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    const kg = editing?.kg ?? repo.weighIns(1)[0]?.kg;
    setText(kg !== undefined ? kgToUnit(kg, unit).toFixed(1) : '');
    setError(undefined);
  }, [visible, editing, unit]);

  const save = () => {
    const kg = toKg(text, unit);
    if (kg === undefined) {
      setError(`Enter a weight in ${unit}`);
      return;
    }
    haptic.commit();
    if (editing) repo.updateWeighIn(editing.id, kg);
    else repo.addWeighIn(kg);
    actions.reload();
    showSnack({ message: 'Weight saved' });
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit weigh-in' : 'Weigh in'}>
      <View style={{ gap: 14 }}>
        <WeightField
          text={text}
          onText={(t) => {
            setText(t);
            setError(undefined);
          }}
          unit={unit}
          label="Weight"
        />
        {error && (
          <T v="caption" color={p.sprint.onTint}>
            {error}
          </T>
        )}
        <Button label="Save" onPress={save} />
      </View>
    </Sheet>
  );
}

/**
 * Set a goal, or change the active one. Start is the trend when the goal is set (editable);
 * the pace choices come from core `allowedPaces` for the start weight.
 */
export function GoalSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().weight;
  const today = useToday();
  const [startText, setStartText] = useState('');
  const [targetText, setTargetText] = useState('');
  const [pace, setPace] = useState(0);
  const [startDate, setStartDate] = useState<IsoDate>(today);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    const goal = repo.weightGoal();
    const active = goal?.status === 'active' ? goal : undefined;
    const startKg = active?.startKg ?? repo.weightSummary()?.trendKg;
    const step = unit === 'lb' ? unitToKg(10, 'lb') : 5;
    setEditing(active !== undefined);
    setStartDate(active?.startDate ?? today);
    setStartText(startKg !== undefined ? kgToUnit(startKg, unit).toFixed(1) : '');
    setTargetText(active ? kgToUnit(active.targetKg, unit).toFixed(1) : startKg !== undefined ? kgToUnit(startKg - step, unit).toFixed(1) : '');
    setPace(active?.paceKgWeek ?? (startKg !== undefined ? (allowedPaces(unit, startKg)[1] ?? allowedPaces(unit, startKg)[0]!) : unitToKg(unit === 'lb' ? 1 : 0.5, unit)));
    setError(undefined);
  }, [visible, unit, today]);

  const startKg = toKg(startText, unit);
  const targetKg = toKg(targetText, unit);
  const paces = allowedPaces(unit, startKg ?? 80);
  // A pace no longer allowed for a lighter start snaps to the fastest one that is.
  const shownPace = paces.find((x) => Math.abs(x - pace) < 1e-6) ?? paces[paces.length - 1]!;
  const valid = startKg !== undefined && targetKg !== undefined && Math.abs(targetKg - startKg) >= 0.1;
  const expected = valid ? expectedGoalDate({ startDate, startKg, targetKg, paceKgWeek: shownPace }) : undefined;

  const save = () => {
    if (startKg === undefined || targetKg === undefined) {
      setError(`Enter the start and target in ${unit}`);
      return;
    }
    if (!valid) {
      setError('Pick a target different from the start');
      return;
    }
    haptic.commit();
    if (editing) repo.updateWeightGoal({ startKg, targetKg, paceKgWeek: shownPace });
    else repo.setWeightGoal({ startKg, targetKg, paceKgWeek: shownPace });
    actions.reload();
    showSnack({ message: editing ? 'Goal updated' : 'Goal set' });
    onClose();
  };

  const clear = () => setError(undefined);
  return (
    <Sheet visible={visible} onClose={onClose} title={editing ? 'Edit goal' : 'Weight goal'}>
      <View style={{ gap: 14 }}>
        <View style={{ gap: 6 }}>
          <T v="labelStrong" tone="secondary">
            Start
          </T>
          <WeightField text={startText} onText={(t) => (setStartText(t), clear())} unit={unit} label="Start weight" />
        </View>
        <View style={{ gap: 6 }}>
          <T v="labelStrong" tone="secondary">
            Target
          </T>
          <WeightField text={targetText} onText={(t) => (setTargetText(t), clear())} unit={unit} label="Target weight" step={unit === 'lb' ? 1 : 0.5} />
        </View>
        <View style={{ gap: 6 }}>
          <T v="labelStrong" tone="secondary">
            Pace
          </T>
          <Segmented look="inset" options={paces.map((x) => ({ value: String(x), label: paceLabel(x, unit).replace(' a week', '') }))} value={String(shownPace)} onChange={(v) => setPace(Number(v))} />
          <T v="caption" tone="secondary">
            Per week. Faster than 1% of your weight a week is not offered.
          </T>
        </View>
        <View style={s.expected}>
          <T v="label" tone="secondary">
            Expected
          </T>
          <T v="bodyStrong" num>
            {expected ? longDate(expected) : 'Enter a start and target'}
          </T>
        </View>
        {error && (
          <T v="caption" color={p.sprint.onTint}>
            {error}
          </T>
        )}
        <Button label={editing ? 'Save goal' : 'Set goal'} onPress={save} />
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((p) => ({
  field: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 52, height: 52, borderRadius: 14, backgroundColor: p.inset, alignItems: 'center', justifyContent: 'center' },
  valueWrap: { flex: 1, height: 52, borderRadius: 14, backgroundColor: p.inset, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  value: { fontFamily: FONT, fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 72, textAlign: 'right', padding: 0 },
  expected: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
}));
