/**
 * In-run screens (mockups Run, RunPace, RunSprint). The gauge follows the current step:
 * heart-rate ring, pace ring, full-screen sprint countdown or a plain timer. Numbers that
 * change every second live in tiny components subscribed to one formatted value each, so
 * a tick re-renders a text node, not the screen.
 */
import { type DistanceUnit, type Step, formatClock, formatDistance, paceToUnit } from '@fit/core';
import { memo, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHrProfile, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, motion, type Palette, toneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';
import { type Live, lap, pause, paceRangeFor, resume, setLocked, skipStep, useLive, useRun } from './engine';
import { type Arc, Ring } from './Ring';
import { gaugeFor, hrRangeFor, repLabel, stepAmount, stepName, stepTargetText, stepTone } from './steps';

// ---------- live text ----------

const clock = (ms: number) => formatClock(Math.ceil(ms / 1000));

function paceText(secPerKm: number | undefined, unit: DistanceUnit): string {
  return secPerKm === undefined || !Number.isFinite(secPerKm) ? '-:--' : formatClock(paceToUnit(secPerKm, unit));
}

function shortDistance(m: number, unit: DistanceUnit): string {
  return unit === 'km' && m < 1000 ? `${Math.round(m)} m` : formatDistance(m, unit, 2);
}

const LiveText = memo(function LiveText({ pick, v = 'stat', color, size }: { pick: (l: Live) => string; v?: 'stat' | 'statSm'; color?: string; size?: number }) {
  const text = useLive(pick);
  return (
    <T v={v} num color={color} style={size ? { fontSize: size, lineHeight: size * 1.05, letterSpacing: -size * 0.04 } : undefined}>
      {text}
    </T>
  );
});

/** Time or distance left in the step; elapsed in the step for open steps. */
function leftInStep(l: Live, unit: DistanceUnit): string {
  if (l.stepRemainingMs !== undefined) return clock(l.stepRemainingMs);
  if (l.stepRemainingM !== undefined) return shortDistance(l.stepRemainingM, unit);
  // Counting up, so round down like Elapsed.
  return formatClock(Math.floor(l.stepElapsedMs / 1000));
}

const leftLabel = (step: Step) => (step.duration.type === 'open' ? 'In step' : 'Left in step');

// ---------- gauges ----------

function useRingSize(): number {
  const { width } = useWindowDimensions();
  return Math.min(300, width - 60);
}

const HrGauge = memo(function HrGauge({ step }: { step: Step }) {
  const p = usePalette();
  const s = useStyles();
  const size = useRingSize();
  const zones = useHrProfile()?.zones;
  const range = hrRangeFor(step, zones);
  const zone = step.target.type === 'hr_zone' ? step.target.zone : zones?.find((z) => range && z.minBpm <= range.minBpm && z.maxBpm >= range.minBpm)?.zone;
  const arcs: Arc[] = [0, 1, 2, 3, 4].map((i) => ({ from: i / 5, to: (i + 1) / 5, color: i + 1 === zone ? p.run.color : p.ringTrack, width: i + 1 === zone ? 14 : 10 }));
  return (
    <View style={[s.gauge, { width: size, height: size * 0.94 }]}>
      <Ring size={size} arcs={arcs} gapPx={5} markerColor={p.text} bg={p.bg} />
      <View style={s.gaugeCenter} pointerEvents="none">
        <T v="labelStrong" color={p.run.color}>
          {zone ? `Zone ${zone}` : 'Heart rate'}
        </T>
        <T v="title" num style={{ fontSize: size * 0.17, lineHeight: size * 0.19 }}>
          {range ? `${range.minBpm}-${range.maxBpm}` : '-'}
        </T>
        <T v="label" tone="secondary">
          bpm target
        </T>
        <T v="caption" tone="tertiary" style={{ marginTop: 6 }}>
          {zones ? 'HR will sync from Garmin' : 'Set heart rate zones in Settings'}
        </T>
      </View>
      <View style={[s.ends, { top: size * 0.82 }]} pointerEvents="none">
        <T v="micro" tone="tertiary">
          Z1
        </T>
        <T v="micro" tone="tertiary">
          Z5
        </T>
      </View>
    </View>
  );
});

/** Where a pace sits on the ring: slower to the left, faster to the right. */
function pacePos(secPerKm: number, slowEnd: number, fastEnd: number): number {
  return Math.min(1, Math.max(0, (slowEnd - secPerKm) / (slowEnd - fastEnd)));
}

const PaceGauge = memo(function PaceGauge({ step }: { step: Step }) {
  const p = usePalette();
  const s = useStyles();
  const size = useRingSize();
  const unit = useUnits().distance;
  const range = paceRangeFor(step);
  const pace = useLive((l) => (l.paceSecPerKm === undefined ? undefined : Math.round(l.paceSecPerKm)));
  const color = toneColor(p, stepTone(step));
  if (!range) return <TimerGauge step={step} />;
  const slowEnd = range.maxSecPerKm + 75;
  const fastEnd = range.minSecPerKm - 75;
  const arcs: Arc[] = [
    { from: 0, to: 1, color: p.ringTrack, width: 10 },
    { from: pacePos(range.maxSecPerKm, slowEnd, fastEnd), to: pacePos(range.minSecPerKm, slowEnd, fastEnd), color, width: 14 },
  ];
  const status = pace === undefined ? 'Finding pace' : pace > range.maxSecPerKm ? 'A little slow' : pace < range.minSecPerKm ? 'A little fast' : 'On pace';
  return (
    <View style={[s.gauge, { width: size, height: size * 0.94 }]}>
      <Ring size={size} arcs={arcs} marker={pace === undefined ? undefined : pacePos(pace, slowEnd, fastEnd)} markerColor={p.text} bg={p.bg} />
      <View style={s.gaugeCenter} pointerEvents="none">
        <T v="labelStrong" color={status === 'On pace' ? color : p.textSecondary}>
          {status}
        </T>
        <T v="title" num style={{ fontSize: size * 0.3, lineHeight: size * 0.32, letterSpacing: -size * 0.012 }}>
          {paceText(pace, unit)}
        </T>
        <T v="label" tone="secondary">
          {`/${unit}, target ${formatClock(paceToUnit(range.minSecPerKm, unit))}-${formatClock(paceToUnit(range.maxSecPerKm, unit))}`}
        </T>
      </View>
      <View style={[s.ends, { top: size * 0.82 }]} pointerEvents="none">
        <T v="micro" tone="tertiary">
          Slower
        </T>
        <T v="micro" tone="tertiary">
          Faster
        </T>
      </View>
    </View>
  );
});

const TimerGauge = memo(function TimerGauge({ step }: { step: Step }) {
  const p = usePalette();
  const s = useStyles();
  const size = useRingSize();
  const unit = useUnits().distance;
  const progress = useLive((l) => (l.stepProgress === undefined ? undefined : Math.round(l.stepProgress * 200) / 200));
  return (
    <View style={[s.gauge, { width: size, height: size * 0.94 }]}>
      <Ring size={size} arcs={[{ from: 0, to: 1, color: p.ringTrack, width: 10 }]} progress={progress} progressColor={toneColor(p, stepTone(step))} markerColor={p.text} bg={p.bg} />
      <View style={s.gaugeCenter} pointerEvents="none">
        <T v="labelStrong" tone="secondary">
          {stepName(step)}
        </T>
        <LiveText pick={(l) => leftInStep(l, unit)} size={size * 0.27} />
        <T v="label" tone="secondary">
          {leftLabel(step).toLowerCase()}
        </T>
      </View>
    </View>
  );
});

// ---------- pieces ----------

/** Whole-workout progress: one segment per step, upcoming steps faded. */
const WorkoutBar = memo(function WorkoutBar({ steps, idx }: { steps: readonly Step[]; idx: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 2, height: 6 }} accessibilityRole="progressbar" accessibilityValue={{ min: 1, max: steps.length, now: idx + 1 }}>
      {steps.map((st, i) => (
        <View
          key={i}
          style={{
            flexGrow: st.duration.type === 'time' ? Math.max(0.4, st.duration.seconds / 60) : st.duration.type === 'distance' ? Math.max(0.4, st.duration.meters / 200) : 4,
            flexBasis: 0,
            borderRadius: 3,
            backgroundColor: toneColor(p, stepTone(st)),
            opacity: i <= idx ? 1 : 0.35,
          }}
        />
      ))}
    </View>
  );
});

function NextCard({ step, unit, tint }: { step: Step | undefined; unit: DistanceUnit; tint?: string }) {
  const s = useStyles();
  if (!step) return null;
  return (
    <View style={[s.next, tint ? { backgroundColor: tint } : null]}>
      <T v="caption" tone="secondary">
        Next
      </T>
      <T v="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
        {stepName(step)}
      </T>
      <T v="bodyStrong" num>
        {stepAmount(step, unit)}
      </T>
    </View>
  );
}

function Controls({ step, onEnd, light }: { step: Step; onEnd: () => void; light?: boolean }) {
  const p = usePalette();
  const s = useStyles();
  const phase = useRun((r) => r.phase);
  const paused = phase === 'paused';
  const open = step.duration.type === 'open';
  const side = [s.ctrl, light ? { backgroundColor: 'rgba(255,255,255,0.7)' } : null];
  return (
    <View style={s.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel="End workout"
        style={side}
        onPress={() => {
          haptic.commit();
          onEnd();
        }}
      >
        <Icons.stop size={18} color={p.text} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paused ? 'Resume' : 'Pause'}
        style={s.primaryCtrl}
        onPress={() => {
          haptic.commit();
          if (paused) resume();
          else pause();
        }}
      >
        {paused ? <Icons.play size={28} color={p.onPrimary} /> : <Icons.pause size={26} color={p.onPrimary} />}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Lap' : 'Skip step'}
        style={side}
        onPress={() => {
          haptic.commit();
          if (open) lap();
          else skipStep();
        }}
      >
        {open ? <Icons.flag size={20} color={p.text} /> : <Icons.skip size={20} color={p.text} />}
      </Pressable>
    </View>
  );
}

function TopBar({ title, sub, light }: { title: string; sub: string; light?: boolean }) {
  const p = usePalette();
  const s = useStyles();
  const bg = light ? { backgroundColor: 'rgba(255,255,255,0.7)' } : null;
  return (
    <View style={s.top}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Lock screen"
        style={[s.round, bg]}
        onPress={() => {
          haptic.commit();
          setLocked(true);
        }}
      >
        <Icons.lock size={18} color={p.text} />
      </Pressable>
      <View style={{ alignItems: 'center', flex: 1 }}>
        <T v="labelStrong" numberOfLines={1}>
          {title}
        </T>
        <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
          {sub}
        </T>
      </View>
      {/* Balances the lock button. The live map button (mockup Run) goes here later. */}
      <View style={{ width: 44 }} />
    </View>
  );
}

function PausedPill() {
  const s = useStyles();
  const paused = useRun((r) => r.phase === 'paused');
  if (!paused) return null;
  return (
    <Animated.View entering={FadeIn.duration(motion.fast)} style={s.pausedPill}>
      <T v="captionStrong" tone="secondary">
        Paused
      </T>
    </Animated.View>
  );
}

/** Covers the screen while locked; a long press on the pill unlocks. */
function LockOverlay() {
  const p = usePalette();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const locked = useRun((r) => r.locked);
  const [hint, setHint] = useState(false);
  if (!locked) return null;
  return (
    <Pressable style={[s.lockLayer, { paddingBottom: insets.bottom + 36 }]} onPress={() => setHint(true)} accessibilityLabel="Screen locked">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hold to unlock"
        delayLongPress={600}
        onLongPress={() => {
          haptic.lift();
          setHint(false);
          setLocked(false);
        }}
        style={s.unlock}
      >
        <Icons.lockOpen size={18} color={p.onPrimary} />
        <T v="labelStrong" color={p.onPrimary}>
          {hint ? 'Press and hold to unlock' : 'Hold to unlock'}
        </T>
      </Pressable>
    </Pressable>
  );
}

// ---------- screens ----------

export function InRun({ onEnd }: { onEnd: () => void }) {
  const steps = useRun((r) => r.steps);
  const idx = useRun((r) => r.stepIdx);
  const step = steps[Math.min(idx, steps.length - 1)];
  if (!step) return null;
  return gaugeFor(step) === 'sprint' ? <SprintView step={step} onEnd={onEnd} /> : <GaugeView step={step} onEnd={onEnd} />;
}

function GaugeView({ step, onEnd }: { step: Step; onEnd: () => void }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;
  const name = useRun((r) => r.name);
  const steps = useRun((r) => r.steps);
  const idx = useRun((r) => r.stepIdx);
  const outdoor = useRun((r) => r.mode === 'outdoor');
  const gauge = gaugeFor(step);
  const sub = repLabel(steps, idx) ?? (steps.length > 1 ? `Step ${idx + 1} of ${steps.length}` : stepName(step));

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
      <TopBar title={name} sub={sub} />
      {steps.length > 1 && <WorkoutBar steps={steps} idx={idx} />}
      <Animated.View key={idx} entering={FadeIn.duration(motion.base)} style={{ alignItems: 'center' }}>
        {gauge === 'hr' ? <HrGauge step={step} /> : gauge === 'pace' ? <PaceGauge step={step} /> : <TimerGauge step={step} />}
      </Animated.View>
      <PausedPill />

      {gauge !== 'timer' && (
        <View style={s.cards}>
          <View style={s.card}>
            <LiveText pick={(l) => leftInStep(l, unit)} />
            <T v="caption" tone="secondary">
              {leftLabel(step)}
            </T>
          </View>
          <View style={s.card}>
            {outdoor ? <LiveText pick={(l) => paceText(l.stepDistanceM > 10 ? l.stepElapsedMs / l.stepDistanceM : undefined, unit)} /> : <LiveText pick={(l) => clock(l.stepElapsedMs)} />}
            <T v="caption" tone="secondary">
              {outdoor ? `Step pace /${unit}` : 'In step'}
            </T>
          </View>
        </View>
      )}

      <View style={s.row3}>
        <View style={{ flex: 1 }}>
          <LiveText v="statSm" pick={(l) => formatClock(Math.floor(l.activeMs / 1000))} />
          <T v="caption" tone="secondary">
            Elapsed
          </T>
        </View>
        {outdoor && (
          <View style={{ flex: 1 }}>
            <LiveText v="statSm" pick={(l) => formatDistance(l.distanceM, unit, 2)} />
            <T v="caption" tone="secondary">
              Distance
            </T>
          </View>
        )}
        {outdoor && (
          <View style={{ flex: 1 }}>
            <LiveText v="statSm" pick={(l) => paceText(l.paceSecPerKm, unit)} />
            <T v="caption" tone="secondary">
              {`Pace /${unit}`}
            </T>
          </View>
        )}
      </View>

      <View style={{ marginTop: 'auto', gap: 14 }}>
        <NextCard step={steps[idx + 1]} unit={unit} />
        <Controls step={step} onEnd={onEnd} />
      </View>
      <LockOverlay />
    </View>
  );
}

function SprintView({ step, onEnd }: { step: Step; onEnd: () => void }) {
  const p = usePalette();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;
  const name = useRun((r) => r.name);
  const steps = useRun((r) => r.steps);
  const idx = useRun((r) => r.stepIdx);
  const { width } = useWindowDimensions();
  const sprintIdx = steps.map((st, i) => [st, i] as const).filter(([st]) => st.activity === step.activity && stepName(st) === stepName(step));
  const at = sprintIdx.findIndex(([, i]) => i === idx);
  const target = stepTargetText(step, unit, paceRangeFor, undefined);

  return (
    <Animated.View entering={FadeIn.duration(motion.base)} style={[s.screen, { backgroundColor: p.sprint.tint, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 20 }]}>
      <TopBar title={name} sub={repLabel(steps, idx) ?? stepName(step)} light />
      <WorkoutBar steps={steps} idx={idx} />
      <View style={{ alignItems: 'center', marginTop: 24 }}>
        <T v="title" style={{ fontSize: 28, lineHeight: 34 }}>
          {stepName(step)}
        </T>
        {target && (
          <T v="body" color={p.sprint.onTint} style={{ marginTop: 4 }}>
            {target}
          </T>
        )}
        <LiveText pick={(l) => leftInStep(l, unit)} size={Math.min(180, width * 0.44)} />
        {sprintIdx.length > 1 && (
          <View style={s.reps}>
            {sprintIdx.map(([, i], n) => (
              <View key={i} style={[s.rep, { backgroundColor: n < at ? p.sprint.onTint : n === at ? p.sprint.color : sprintDot(p) }]} />
            ))}
          </View>
        )}
      </View>
      <PausedPill />
      <View style={{ marginTop: 'auto', gap: 14 }}>
        <NextCard step={steps[idx + 1]} unit={unit} tint="rgba(255,255,255,0.7)" />
        <Controls step={step} onEnd={onEnd} light />
      </View>
      <LockOverlay />
    </Animated.View>
  );
}

const sprintDot = (p: Palette) => (p.scheme === 'dark' ? 'rgba(231,188,167,0.18)' : 'rgba(126,70,48,0.18)');

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg, paddingHorizontal: 20, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
  gauge: { alignSelf: 'center', marginTop: 4 },
  gaugeCenter: { position: 'absolute', left: 0, right: 0, top: '22%', alignItems: 'center' },
  ends: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: '15%' },
  cards: { flexDirection: 'row', gap: 10 },
  card: { flex: 1, backgroundColor: p.surface, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  row3: { flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  next: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: p.surface },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  ctrl: { width: 56, height: 56, borderRadius: 28, backgroundColor: p.surface, alignItems: 'center', justifyContent: 'center' },
  primaryCtrl: { width: 80, height: 80, borderRadius: 40, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' },
  pausedPill: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999, backgroundColor: p.inset },
  reps: { flexDirection: 'row', gap: 6, width: 220, marginTop: 20 },
  rep: { flex: 1, height: 8, borderRadius: 4 },
  lockLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.04)' },
  unlock: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, height: 48, borderRadius: 24, backgroundColor: p.primary },
}));
