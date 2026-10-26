/**
 * The fields of one step, shown under it when it is open in the builder (spec §4 Builder
 * UX): activity, time or distance, and the target picker. Every number is a stepper. The
 * kinds offered come from targetKinds(), and switching kind uses defaultTarget().
 */
import {
  type Activity,
  type DistanceUnit,
  type HrZone,
  METERS_PER_MILE,
  PACE_ZONES,
  type PaceZone,
  type SessionMode,
  type Step,
  type Target,
  type TargetKind,
  defaultTarget,
  formatClock,
  paceToUnit,
  targetKind,
  targetKinds,
  zonePace,
} from '@fit/core';
import { TextInput, View } from 'react-native';
import { kphToUnit, speedUnit, unitToKph } from '@/features/run/speed';
import { createStyles, usePalette } from '@/theme';
import { Chip, NumStepper, Segmented, T } from '@/ui/primitives';

export interface EditorOpts {
  mode: SessionMode;
  unit: DistanceUnit;
  easyBy: 'pace' | 'hr';
  vdot?: number;
}

const KIND_LABEL: Record<TargetKind, string> = { pace: 'Pace', hr: 'Heart rate', effort: 'Effort', speed: 'Speed', none: 'None' };
export const ZONE_LABEL: Record<PaceZone, string> = { easy: 'Easy', steady: 'Steady', tempo: 'Tempo', threshold: 'Threshold', interval: 'Interval', repetition: 'Repetition' };
const ACTIVITIES: readonly { value: Activity; label: string }[] = [
  { value: 'run', label: 'Run' },
  { value: 'walk', label: 'Walk' },
  { value: 'sprint', label: 'Sprint' },
];

/** Seconds per km shown as seconds per display unit, and back. */
const toUnitPace = (secPerKm: number, unit: DistanceUnit) => Math.round(paceToUnit(secPerKm, unit) / 5) * 5;
const fromUnitPace = (sec: number, unit: DistanceUnit) => (unit === 'mi' ? sec / (METERS_PER_MILE / 1000) : sec);
const unitM = (unit: DistanceUnit) => (unit === 'mi' ? METERS_PER_MILE : 1000);

export function StepEditor({ step, onChange, opts }: { step: Step; onChange: (s: Step) => void; opts: EditorOpts }) {
  const s = useStyles();
  const p = usePalette();
  const kinds = targetKinds(step.activity, opts.mode);
  const kind = targetKind(step.target);
  const d = step.duration;
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch });
  const setTarget = (target: Target) => set({ target });

  const setActivity = (activity: Activity) => {
    const next: Step = { ...step, activity };
    // Sprints are time based with an effort target; other kinds keep theirs when allowed.
    if (activity === 'sprint' && d.type !== 'time') next.duration = { type: 'time', seconds: 30 };
    if (!targetKinds(activity, opts.mode).includes(kind)) next.target = defaultTarget(activity, undefined, opts);
    onChange(next);
  };

  const setDurationType = (type: 'time' | 'distance') => {
    if (type === d.type) return;
    set({ duration: type === 'time' ? { type: 'time', seconds: 600 } : { type: 'distance', meters: step.activity === 'walk' ? 400 : Math.round(unitM(opts.unit)) } });
  };

  return (
    <View style={s.editor}>
      <TextInput
        value={step.label ?? ''}
        onChangeText={(label) => set({ label: label.trim() === '' ? undefined : label })}
        placeholder="Step name, optional"
        placeholderTextColor={p.textTertiary}
        accessibilityLabel="Step name"
        style={s.input}
      />
      <Segmented look="inset" options={ACTIVITIES} value={step.activity === 'rest' ? 'walk' : (step.activity as 'run' | 'walk' | 'sprint')} onChange={setActivity} />

      {step.activity !== 'sprint' && (
        <Segmented
          look="inset"
          options={[
            { value: 'time', label: 'Time' },
            { value: 'distance', label: 'Distance' },
          ]}
          value={d.type === 'distance' ? 'distance' : 'time'}
          onChange={setDurationType}
        />
      )}
      {d.type === 'distance' ? (
        <Line label="Distance">
          <NumStepper
            label="Distance"
            value={Math.round((d.meters / unitM(opts.unit)) * 100) / 100}
            min={opts.unit === 'mi' ? 0.05 : 0.1}
            max={opts.unit === 'mi' ? 30 : 50}
            step={opts.unit === 'mi' ? 0.05 : 0.1}
            width={96}
            format={(n) => `${n.toFixed(2)} ${opts.unit}`}
            onChange={(n) => set({ duration: { type: 'distance', meters: Math.round(n * unitM(opts.unit)) } })}
          />
        </Line>
      ) : (
        <Line label="Time">
          <NumStepper
            label="Time"
            value={d.type === 'time' ? d.seconds : 600}
            min={step.activity === 'sprint' ? 5 : 15}
            max={4 * 3600}
            step={step.activity === 'sprint' ? 5 : 15}
            width={96}
            format={(n) => (n < 60 ? `${n} s` : formatClock(n))}
            onChange={(seconds) => set({ duration: { type: 'time', seconds } })}
          />
        </Line>
      )}

      {kinds.length > 1 && (
        <View style={s.chips}>
          {kinds.map((k) => (
            <Chip key={k} label={KIND_LABEL[k]} on={kind === k} onPress={() => k !== kind && setTarget(defaultTarget(step.activity, k, opts))} />
          ))}
        </View>
      )}
      <TargetFields target={step.target} onChange={setTarget} opts={opts} />
    </View>
  );
}

function TargetFields({ target: t, onChange, opts }: { target: Target; onChange: (t: Target) => void; opts: EditorOpts }) {
  const s = useStyles();
  const u = opts.unit;
  if (t.type === 'pace_zone' || t.type === 'pace_range') {
    // A custom range starts from the zone it replaces, or a 9:00 to 10:00 /mi easy range.
    const fromZone = (zone: PaceZone) => (opts.vdot !== undefined ? zonePace(opts.vdot, zone) : { minSecPerKm: 335, maxSecPerKm: 373 });
    return (
      <>
        <View style={s.chips}>
          {PACE_ZONES.map((z) => (
            <Chip key={z} label={ZONE_LABEL[z]} on={t.type === 'pace_zone' && t.zone === z} onPress={() => onChange({ type: 'pace_zone', zone: z })} />
          ))}
          <Chip
            label="Custom"
            on={t.type === 'pace_range'}
            onPress={() => {
              if (t.type === 'pace_range') return;
              const r = fromZone(t.zone);
              onChange({ type: 'pace_range', minSecPerKm: r.minSecPerKm, maxSecPerKm: r.maxSecPerKm });
            }}
          />
        </View>
        {t.type === 'pace_range' && (
          <>
            <Line label="Fastest">
              <NumStepper label="Fastest pace" value={toUnitPace(t.minSecPerKm, u)} min={150} max={1200} step={5} width={96} format={(n) => `${formatClock(n)} /${u}`} onChange={(n) => onChange({ ...t, minSecPerKm: fromUnitPace(n, u) })} />
            </Line>
            <Line label="Slowest">
              <NumStepper label="Slowest pace" value={toUnitPace(t.maxSecPerKm, u)} min={150} max={1200} step={5} width={96} format={(n) => `${formatClock(n)} /${u}`} onChange={(n) => onChange({ ...t, maxSecPerKm: fromUnitPace(n, u) })} />
            </Line>
          </>
        )}
        {t.type === 'pace_zone' && opts.vdot === undefined && (
          <T v="caption" tone="tertiary">
            Zone paces come from your pace profile. Set it in Settings to see them here.
          </T>
        )}
      </>
    );
  }
  if (t.type === 'hr_zone' || t.type === 'hr_range' || t.type === 'hr_max') {
    return (
      <>
        <View style={s.chips}>
          {([1, 2, 3, 4, 5] as HrZone[]).map((z) => (
            <Chip key={z} label={`Zone ${z}`} on={t.type === 'hr_zone' && t.zone === z} onPress={() => onChange({ type: 'hr_zone', zone: z })} />
          ))}
          <Chip label="Range" on={t.type === 'hr_range'} onPress={() => t.type !== 'hr_range' && onChange({ type: 'hr_range', minBpm: 130, maxBpm: 145 })} />
          <Chip label="Under" on={t.type === 'hr_max'} onPress={() => t.type !== 'hr_max' && onChange({ type: 'hr_max', maxBpm: 145 })} />
        </View>
        {t.type === 'hr_range' && (
          <>
            <Line label="Low">
              <NumStepper label="Low heart rate" value={t.minBpm} min={60} max={220} width={96} format={(n) => `${n} bpm`} onChange={(minBpm) => onChange({ ...t, minBpm })} />
            </Line>
            <Line label="High">
              <NumStepper label="High heart rate" value={t.maxBpm} min={60} max={220} width={96} format={(n) => `${n} bpm`} onChange={(maxBpm) => onChange({ ...t, maxBpm })} />
            </Line>
          </>
        )}
        {t.type === 'hr_max' && (
          <Line label="Stay under">
            <NumStepper label="Heart rate cap" value={t.maxBpm} min={60} max={220} width={96} format={(n) => `${n} bpm`} onChange={(maxBpm) => onChange({ ...t, maxBpm })} />
          </Line>
        )}
      </>
    );
  }
  if (t.type === 'effort') {
    return (
      <Line label="Effort">
        <NumStepper label="Effort" value={t.rpe} min={1} max={10} width={96} format={(n) => `RPE ${n}`} onChange={(rpe) => onChange({ ...t, rpe })} />
      </Line>
    );
  }
  if (t.type === 'treadmill') {
    return (
      <>
        <Line label="Speed">
          <NumStepper
            label="Speed"
            value={kphToUnit(t.speedKph, u)}
            min={1}
            max={u === 'mi' ? 15 : 24}
            step={0.1}
            width={96}
            format={(n) => `${n.toFixed(1)} ${speedUnit(u)}`}
            onChange={(n) => onChange({ ...t, speedKph: Math.round(unitToKph(n, u) * 100) / 100 })}
          />
        </Line>
        <Line label="Incline">
          <NumStepper label="Incline" value={t.inclinePct ?? 0} min={0} max={15} step={0.5} width={96} format={(n) => (n === 0 ? 'Flat' : `${n.toFixed(1)} %`)} onChange={(n) => onChange(n === 0 ? { type: 'treadmill', speedKph: t.speedKph } : { ...t, inclinePct: n })} />
        </Line>
      </>
    );
  }
  return null;
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.line}>
      <T v="label" tone="secondary">
        {label}
      </T>
      {children}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  editor: { gap: 10, paddingTop: 6, paddingBottom: 12 },
  input: { height: 42, borderRadius: 10, backgroundColor: p.inset, paddingHorizontal: 12, color: p.text, fontFamily: 'Inter', fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
}));
