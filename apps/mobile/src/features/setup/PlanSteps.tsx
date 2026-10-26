import { type IsoDate, type PlanInputs, type PlanPresetId, type Weekday, addDays, startOfWeek } from '@fit/core';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useFormStyles } from '@/features/items/ItemSheet';
import { mmss, parseMmss, shortDate, weekdayLetter, weekdayShort } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Chip, Group, IconButton, Row, Segmented, T } from '@/ui/primitives';
import { haptic } from '@/lib/haptics';

export type PlanChoice = PlanPresetId | 'none';

interface Option {
  id: PlanChoice | 'later';
  name: string;
  sub: string;
  later?: boolean;
}

const RACE: readonly Option[] = [
  { id: '5k-8wk', name: '5K', sub: '8 weeks, intervals, tempo and long runs' },
  { id: 'later', name: '10K', sub: '10 weeks, threshold focus', later: true },
  { id: 'later', name: 'Half marathon', sub: '12 weeks, long run progression', later: true },
];

const FITNESS: readonly Option[] = [
  { id: 'z2-base-8wk', name: 'Zone 2 Base', sub: 'Heart rate based, builds aerobic base' },
  { id: 'later', name: 'Base builder', sub: 'Mostly easy miles with strides', later: true },
  { id: 'later', name: 'Speed block', sub: '6 weeks of sprints and hills', later: true },
];

export function PlanPickStep({ choice, onChoose }: { choice: PlanChoice | undefined; onChoose: (c: PlanChoice) => void }) {
  return (
    <View style={{ gap: 16 }}>
      <T v="display" style={{ fontSize: 26 }} accessibilityRole="header">
        Pick a running plan
      </T>
      <Section title="Train for a race" options={RACE} choice={choice} onChoose={onChoose} />
      <Section title="Build fitness" options={FITNESS} choice={choice} onChoose={onChoose} />
      <Section title="Other" options={[{ id: 'none', name: 'No running plan for now', sub: 'Use the checklist and schedule only' }]} choice={choice} onChoose={onChoose} />
    </View>
  );
}

function Section({ title, options, choice, onChoose }: { title: string; options: readonly Option[]; choice: PlanChoice | undefined; onChoose: (c: PlanChoice) => void }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      <T v="captionStrong" tone="secondary">
        {title}
      </T>
      {options.map((o) => {
        const on = o.id === choice;
        return (
          <Pressable
            key={o.name}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: o.later }}
            disabled={o.later}
            onPress={() => {
              if (o.id === 'later') return;
              haptic.tick();
              onChoose(o.id);
            }}
            style={[s.option, on && { borderColor: p.primary, borderWidth: 1.5 }, o.later && { opacity: 0.5 }]}
          >
            <View style={{ flex: 1 }}>
              <T v={on ? 'bodyStrong' : 'bodyMedium'}>{o.name}</T>
              <T v="caption" tone="secondary">
                {o.sub}
              </T>
            </View>
            {o.later ? (
              <T v="captionMedium" tone="tertiary">
                Later
              </T>
            ) : (
              <View style={[s.radio, on ? { borderWidth: 6, borderColor: p.primary } : { borderColor: p.dashed }]} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const ALL_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function defaultInputs(presetId: PlanPresetId, today: IsoDate): PlanInputs {
  const nextMonday = addDays(startOfWeek(today), 7);
  if (presetId === '5k-8wk') {
    return { presetId, raceDate: addDays(nextMonday, 8 * 7 - 2), daysPerWeek: 3, preferredDays: [2, 4, 6], longRunDay: 6, goalSeconds: 25 * 60 + 30, easyBy: 'pace', treadmill: 'none' };
  }
  return { presetId, startDate: nextMonday, daysPerWeek: 4, preferredDays: [2, 4, 5, 7], longRunDay: 7, easyBy: 'hr', treadmill: 'none' };
}

export function inputsProblem(i: PlanInputs): string | undefined {
  if (i.preferredDays.length < i.daysPerWeek) return `Pick at least ${i.daysPerWeek} run days`;
  if (!i.preferredDays.includes(i.longRunDay)) return 'Pick a long run day from your run days';
  if (i.presetId === '5k-8wk' && !i.goalSeconds) return 'Enter a goal time';
  return undefined;
}

export function PlanDetailsStep({ inputs, onChange, today }: { inputs: PlanInputs; onChange: (i: PlanInputs) => void; today: IsoDate }) {
  const p = usePalette();
  const f = useFormStyles();
  const race = inputs.presetId === '5k-8wk';
  const range = race ? [3, 4, 5] : [3, 4, 5, 6];
  const set = (patch: Partial<PlanInputs>) => onChange({ ...inputs, ...patch });
  const [goalText, setGoalText] = useState(inputs.goalSeconds ? mmss(inputs.goalSeconds) : '');
  const dateValue = race ? inputs.raceDate! : inputs.startDate!;
  const shiftDate = (days: number) => {
    const next = addDays(dateValue, days);
    if (next <= today) return;
    haptic.tick();
    set(race ? { raceDate: next } : { startDate: next });
  };
  const toggleDay = (d: Weekday) => {
    const has = inputs.preferredDays.includes(d);
    const preferredDays = (has ? inputs.preferredDays.filter((x) => x !== d) : [...inputs.preferredDays, d]).sort((a, b) => a - b);
    const longRunDay = preferredDays.includes(inputs.longRunDay) ? inputs.longRunDay : (preferredDays[preferredDays.length - 1] ?? inputs.longRunDay);
    set({ preferredDays, longRunDay });
  };

  return (
    <View style={{ gap: 16 }}>
      <T v="display" style={{ fontSize: 26 }} accessibilityRole="header">
        Run days
      </T>
      <Group>
        <Row label={race ? 'Race day' : 'Starts'}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <IconButton label="A week earlier" bg="none" onPress={() => shiftDate(-7)}>
              <Icons.chevronLeft size={18} color={p.text} />
            </IconButton>
            <T v="bodyStrong" num style={{ minWidth: 96 }} align="center">
              {shortDate(dateValue)}
            </T>
            <IconButton label="A week later" bg="none" onPress={() => shiftDate(7)}>
              <Icons.chevronRight size={18} color={p.text} />
            </IconButton>
          </View>
        </Row>
        {race && (
          <Row label="Goal time" sub="Sets your training paces">
            <TextInput
              value={goalText}
              onChangeText={setGoalText}
              onEndEditing={() => {
                const s = parseMmss(goalText);
                if (s) set({ goalSeconds: s });
                setGoalText(s ? mmss(s) : inputs.goalSeconds ? mmss(inputs.goalSeconds) : '');
              }}
              keyboardType="numbers-and-punctuation"
              placeholder="25:30"
              placeholderTextColor={p.textTertiary}
              accessibilityLabel="Goal time, minutes and seconds"
              style={[f.input, { width: 84, textAlign: 'center', fontWeight: '600', fontVariant: ['tabular-nums'] }]}
            />
          </Row>
        )}
        <View style={{ padding: 16, gap: 10 }}>
          <T v="bodyMedium">Runs per week</T>
          <Segmented look="inset" options={range.map((n) => ({ value: String(n), label: `${n} days` }))} value={String(inputs.daysPerWeek)} onChange={(v) => set({ daysPerWeek: Number(v) })} />
        </View>
      </Group>

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Days you can run
        </T>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {ALL_DAYS.map((d) => {
            const on = inputs.preferredDays.includes(d);
            return (
              <Pressable
                key={d}
                accessibilityRole="checkbox"
                accessibilityLabel={weekdayShort(d)}
                accessibilityState={{ checked: on }}
                onPress={() => {
                  haptic.tick();
                  toggleDay(d);
                }}
                style={{ flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? p.primary : p.surface }}
              >
                <T v="labelStrong" color={on ? p.onPrimary : p.textBody}>
                  {weekdayLetter(d)}
                </T>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Long run day
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {inputs.preferredDays.map((d) => (
            <Chip key={d} label={weekdayShort(d)} on={inputs.longRunDay === d} onPress={() => set({ longRunDay: d })} />
          ))}
        </View>
      </View>

      {race && (
        <View style={{ gap: 8 }}>
          <T v="labelStrong" tone="secondary">
            Easy runs by
          </T>
          <Segmented
            look="inset"
            options={[
              { value: 'pace', label: 'Pace' },
              { value: 'hr', label: 'Heart rate' },
            ]}
            value={inputs.easyBy}
            onChange={(easyBy) => set({ easyBy })}
          />
        </View>
      )}

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Treadmill
        </T>
        <Segmented
          look="inset"
          options={[
            { value: 'none', label: 'None' },
            { value: 'some', label: 'Some days' },
            { value: 'mostly', label: 'Mostly' },
          ]}
          value={inputs.treadmill}
          onChange={(treadmill) => set({ treadmill })}
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: p.surface, minHeight: 60 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
}));
