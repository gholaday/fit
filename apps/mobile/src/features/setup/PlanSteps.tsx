/**
 * Plan wizard steps (spec §8 inputs): the "run 20 minutes" question, the preset list, run
 * days with a race date or a start date and length, and where training paces come from.
 */
import { type IsoDate, type PlanInputs, type PlanPresetId, type PresetInfo, type Weekday, PRESET_IDS, addDays, formatClock, presetInfo, startOfWeek, suggestedPresets, vdotFromRace } from '@fit/core';
import { Pressable, View } from 'react-native';
import { shortDate, weekdayLetter, weekdayShort } from '@/lib/format';
import { TimeWheel } from '@/ui/Wheel';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Chip, Group, IconButton, Row, Segmented, T } from '@/ui/primitives';
import { haptic } from '@/lib/haptics';
import { RACES } from './OnboardingSteps';

export type PlanChoice = PlanPresetId | 'none';

interface Option {
  id: string;
  name: string;
  sub: string;
  tag?: string;
}

function Header({ title, body }: { title: string; body?: string }) {
  return (
    <View>
      <T v="display" style={{ fontSize: 26 }} accessibilityRole="header">
        {title}
      </T>
      {body && (
        <T v="body" tone="secondary" style={{ marginTop: 6, fontSize: 14, lineHeight: 20 }}>
          {body}
        </T>
      )}
    </View>
  );
}

/** Wizard step: "Can you run 20 minutes without stopping?" Highlights presets on the next step. */
export function Run20Step({ answer, onAnswer }: { answer: boolean | undefined; onAnswer: (a: boolean) => void }) {
  const value = answer === undefined ? undefined : answer ? 'yes' : 'no';
  return (
    <View style={{ gap: 16 }}>
      <Header title="Can you run 20 minutes without stopping?" body="At an easy pace you could talk at. The next step points you to plans that fit." />
      <Options
        options={[
          { id: 'yes', name: 'Yes', sub: 'Race plans, base building and Zone 2' },
          { id: 'no', name: 'Not yet', sub: 'Run/walk plans that build up to it, no paces needed' },
        ]}
        value={value}
        onChoose={(v) => onAnswer(v === 'yes')}
      />
    </View>
  );
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "8 weeks, heart rate based, builds aerobic base" or "4, 8 or 12 weeks, brisk ...". */
function presetSub(info: PresetInfo): string {
  if (/^\d/.test(info.subtitle)) return info.subtitle;
  const w = info.weeksOptions;
  const weeks = w && w.length > 1 ? `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]} weeks` : `${info.weeks} weeks`;
  return `${weeks}, ${lower(info.subtitle)}`;
}

const SECTIONS: readonly { title: string; test: (i: PresetInfo) => boolean }[] = [
  { title: 'Train for a race', test: (i) => i.kind === 'race' },
  { title: 'Start running', test: (i) => i.beginner },
  { title: 'Build fitness', test: (i) => i.kind === 'fitness' && !i.beginner && i.measure !== 'z2_minutes' },
  { title: 'Zone 2', test: (i) => i.measure === 'z2_minutes' },
];

export function PlanPickStep({ choice, onChoose, canRun20 }: { choice: PlanChoice | undefined; onChoose: (c: PlanChoice) => void; canRun20: boolean | undefined }) {
  const infos = PRESET_IDS.map(presetInfo);
  const suggested = canRun20 === undefined ? [] : suggestedPresets(canRun20);
  return (
    <View style={{ gap: 16 }}>
      <Header title="Pick a running plan" />
      {SECTIONS.map((sec) => (
        <View key={sec.title} style={{ gap: 6 }}>
          <T v="captionStrong" tone="secondary">
            {sec.title}
          </T>
          <Options
            options={infos.filter(sec.test).map((i) => ({ id: i.id, name: i.name, sub: presetSub(i), tag: suggested.includes(i.id) ? 'Suggested' : undefined }))}
            value={choice}
            onChoose={(id) => onChoose(id as PlanPresetId)}
          />
        </View>
      ))}
      <View style={{ gap: 6 }}>
        <T v="captionStrong" tone="secondary">
          Other
        </T>
        <Options options={[{ id: 'none', name: 'No running plan for now', sub: 'Use the checklist and schedule only' }]} value={choice} onChoose={() => onChoose('none')} />
      </View>
    </View>
  );
}

function Options({ options, value, onChoose }: { options: readonly Option[]; value: string | undefined; onChoose: (id: string) => void }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <View style={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => {
              haptic.tick();
              onChoose(o.id);
            }}
            style={[s.option, on && { borderColor: p.primary, borderWidth: 1.5 }]}
          >
            <View style={{ flex: 1 }}>
              <T v={on ? 'bodyStrong' : 'bodyMedium'}>{o.name}</T>
              <T v="caption" tone="secondary">
                {o.sub}
              </T>
            </View>
            {o.tag && (
              <T v="captionMedium" color={p.primary}>
                {o.tag}
              </T>
            )}
            <View style={[s.radio, on ? { borderWidth: 6, borderColor: p.primary } : { borderColor: p.dashed }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const ALL_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Default run days for a count: spread out, long run at the weekend. */
const DAYS_FOR: Record<number, Weekday[]> = { 3: [2, 4, 6], 4: [2, 4, 5, 7], 5: [1, 2, 4, 5, 7], 6: [1, 2, 3, 4, 5, 7] };

/** Goal time to start the wheel at, by race distance. */
const GOAL_SECONDS: Record<number, number> = { 5000: 25 * 60 + 30, 10000: 55 * 60, 21097.5: 2 * 3600 };

/** Wheel range for a goal time: about 2:50 to 12:00 per km. */
function goalRange(meters: number): { min: number; max: number } {
  const km = meters / 1000;
  return { min: Math.floor(km * 2.8), max: Math.min(359, Math.ceil(km * 12)) };
}

/**
 * Plans start this week: a fitness plan today, a race on the Sunday that ends its last week.
 * Without a pace profile, fitness plans default to a time trial in week 1.
 */
export function defaultInputs(presetId: PlanPresetId, today: IsoDate, vdot: number | undefined): PlanInputs {
  const info = presetInfo(presetId);
  const days = info.daysPerWeek.default;
  const preferredDays = DAYS_FOR[days] ?? DAYS_FOR[4]!;
  const longRunDay = preferredDays[preferredDays.length - 1]!;
  const common = { presetId, daysPerWeek: days, preferredDays, longRunDay, treadmill: 'none' as const };
  if (info.kind === 'race') {
    return { ...common, raceDate: addDays(startOfWeek(today), info.weeks * 7 - 1), goalSeconds: GOAL_SECONDS[info.raceMeters ?? 5000] ?? 25 * 60, easyBy: 'pace' };
  }
  const inputs: PlanInputs = { ...common, startDate: today, easyBy: 'hr' };
  if (info.weeksOptions) inputs.weeks = info.weeks;
  if (info.beginner) inputs.paceSource = 'beginner';
  else if (vdot === undefined) inputs.paceSource = 'trial';
  return inputs;
}

export function inputsProblem(i: PlanInputs): string | undefined {
  const info = presetInfo(i.presetId);
  if (i.preferredDays.length < i.daysPerWeek) return `Pick at least ${i.daysPerWeek} run days`;
  if (!i.preferredDays.includes(i.longRunDay)) return 'Pick a long run day from your run days';
  if (info.kind === 'race' && !i.goalSeconds) return 'Enter a goal time';
  if (i.paceSource === 'race' && !i.fitness?.recentRace) return 'Pick a recent race';
  return undefined;
}

/** Beginner plans are effort based, so they skip the pace step. */
export const needsPaceStep = (presetId: PlanPresetId) => !presetInfo(presetId).beginner;

export function PlanDetailsStep({ inputs, onChange, today }: { inputs: PlanInputs; onChange: (i: PlanInputs) => void; today: IsoDate }) {
  const p = usePalette();
  const info = presetInfo(inputs.presetId);
  const race = info.kind === 'race';
  const { min, max } = info.daysPerWeek;
  const range = Array.from({ length: max - min + 1 }, (_, k) => min + k);
  const set = (patch: Partial<PlanInputs>) => onChange({ ...inputs, ...patch });
  const dateValue = race ? inputs.raceDate! : inputs.startDate!;
  const shiftDate = (days: number) => {
    const next = addDays(dateValue, days);
    // A fitness plan can start today; a race has to be after it.
    if (race ? next <= today : next < today) return;
    haptic.tick();
    set(race ? { raceDate: next } : { startDate: next });
  };
  const toggleDay = (d: Weekday) => {
    const has = inputs.preferredDays.includes(d);
    const preferredDays = (has ? inputs.preferredDays.filter((x) => x !== d) : [...inputs.preferredDays, d]).sort((a, b) => a - b);
    const longRunDay = preferredDays.includes(inputs.longRunDay) ? inputs.longRunDay : (preferredDays[preferredDays.length - 1] ?? inputs.longRunDay);
    set({ preferredDays, longRunDay });
  };
  const goal = race ? goalRange(info.raceMeters ?? 5000) : undefined;

  return (
    <View style={{ gap: 16 }}>
      <Header title="Run days" />
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
        {info.weeksOptions && (
          <View style={{ padding: 16, gap: 10 }}>
            <T v="bodyMedium">Length</T>
            <Segmented look="inset" options={info.weeksOptions.map((n) => ({ value: String(n), label: `${n} weeks` }))} value={String(inputs.weeks ?? info.weeks)} onChange={(v) => set({ weeks: Number(v) })} />
          </View>
        )}
        {range.length > 1 ? (
          <View style={{ padding: 16, gap: 10 }}>
            <T v="bodyMedium">Runs per week</T>
            <Segmented look="inset" options={range.map((n) => ({ value: String(n), label: `${n} days` }))} value={String(inputs.daysPerWeek)} onChange={(v) => set({ daysPerWeek: Number(v) })} />
          </View>
        ) : (
          <Row label="Runs per week" last>
            <T v="bodyStrong" num>{`${min} days`}</T>
          </Row>
        )}
      </Group>

      {goal && (
        <View style={{ gap: 8 }}>
          <T v="labelStrong" tone="secondary">
            {`${info.name} goal time`}
          </T>
          <TimeWheel label="Goal time" seconds={inputs.goalSeconds ?? GOAL_SECONDS[info.raceMeters ?? 5000] ?? 25 * 60} minMinutes={goal.min} maxMinutes={goal.max} onChange={(goalSeconds) => set({ goalSeconds })} />
        </View>
      )}

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

      {race && inputs.paceSource !== 'beginner' && (
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
    </View>
  );
}

type PaceChoice = 'race' | 'trial' | 'goal' | 'current' | 'beginner';

function paceChoice(i: PlanInputs): PaceChoice {
  if (i.paceSource === 'race' || i.fitness?.recentRace) return 'race';
  if (i.paceSource === 'trial' || i.paceSource === 'beginner') return i.paceSource;
  return presetInfo(i.presetId).kind === 'race' ? 'goal' : 'current';
}

/** Wizard step 5 (spec §8): a recent race, a time trial in week 1, the goal time, or effort only. */
export function PaceStep({ inputs, onChange, vdot }: { inputs: PlanInputs; onChange: (i: PlanInputs) => void; vdot: number | undefined }) {
  const info = presetInfo(inputs.presetId);
  const fitness = inputs.fitness ?? { runsPerWeek: 0, weeklyDistanceM: 0, longestRunM: 0 };
  const recent = fitness.recentRace;
  const raceKey = recent ? RACES.find((r) => Math.abs(r.meters - recent.meters) < 1)?.label : undefined;
  const choice = paceChoice(inputs);

  const choose = (c: PaceChoice) => {
    const { recentRace: _drop, ...rest } = fitness;
    if (c === 'race') return onChange({ ...inputs, paceSource: 'race', fitness: { ...fitness, recentRace: recent ?? { meters: 5000, seconds: 30 * 60 } } });
    const next: PlanInputs = { ...inputs, fitness: rest };
    if (c === 'trial' || c === 'beginner') next.paceSource = c;
    else delete next.paceSource;
    onChange(next);
  };
  const setRace = (recentRace: { meters: number; seconds: number }) => onChange({ ...inputs, paceSource: 'race', fitness: { ...fitness, recentRace } });

  const options: Option[] = [{ id: 'race', name: 'A recent race', sub: 'A race or all out effort from the last couple of months' }];
  options.push({ id: 'trial', name: 'Time trial in week 1', sub: 'Run 3 km all out in the first week; the summary offers the new paces' });
  if (info.kind === 'race' && info.raceMeters && inputs.goalSeconds) {
    const goalVdot = Math.round(vdotFromRace(info.raceMeters, inputs.goalSeconds) * 10) / 10;
    options.push({ id: 'goal', name: 'My goal time', sub: `${info.name} in ${formatClock(inputs.goalSeconds)}, VDOT ${goalVdot.toFixed(1)}` });
  } else if (vdot !== undefined) {
    options.push({ id: 'current', name: 'Keep my current paces', sub: `VDOT ${vdot.toFixed(1)}` });
  }
  options.push({ id: 'beginner', name: 'Effort only', sub: 'No pace targets; runs use effort from 1 to 10' });

  return (
    <View style={{ gap: 16 }}>
      <Header title="Training paces" body="Where pace targets come from. You can change them later in Settings, Pace profile." />
      <Options options={options} value={choice} onChoose={(id) => choose(id as PaceChoice)} />
      {choice === 'race' && (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {RACES.map((r) => (
              <Chip key={r.label} label={r.label} on={raceKey === r.label} onPress={() => setRace({ meters: r.meters, seconds: recent && raceKey === r.label ? recent.seconds : r.seconds })} />
            ))}
          </View>
          {recent && (
            <View style={{ paddingTop: 6 }}>
              <TimeWheel label="Race time" seconds={recent.seconds} onChange={(seconds) => setRace({ ...recent, seconds })} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, backgroundColor: p.surface, minHeight: 60 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
}));
