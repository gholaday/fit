import { type HrProfileInput, type PlanInputs, type UnitPrefs, presetInfo } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInLeft, FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, showSnack, useHrProfile, usePlan, useSettings, useToday, useVdot } from '@/data/store';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, Segmented, T } from '@/ui/primitives';
import { type PlanChoice, PaceStep, PlanDetailsStep, PlanPickStep, Run20Step, defaultInputs, inputsProblem, needsPaceStep } from './PlanSteps';
import { ZonesStep, useZonesDraft } from './ZonesStep';
import { defaultFitness, defaultHeartInput, FitnessStep, HeartStep } from './OnboardingSteps';
import { haptic } from '@/lib/haptics';

type Step = 'units' | 'heart' | 'zones' | 'run20' | 'pick' | 'fitness' | 'details' | 'pace';
/** The plan part grows once a preset is picked: beginner plans skip the pace step. */
function planSteps(choice: PlanChoice | undefined): Step[] {
  if (!choice || choice === 'none') return ['run20', 'pick'];
  return ['run20', 'pick', 'fitness', 'details', ...(needsPaceStep(choice) ? (['pace'] as const) : [])];
}
/** Step changes slide in on the UI thread; Reanimated follows the system reduce-motion setting. */
const SLIDE_MS = 220;

/**
 * First-launch setup (units, max heart rate, running plan, starting fitness). Also opened
 * from Settings with `only=zones` (full zone editor) or `only=plan` to change one part.
 */
export function SetupScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { only } = useLocalSearchParams<{ only?: 'zones' | 'plan' }>();
  const settings = useSettings();
  const today = useToday();
  const plan = usePlan();
  const vdot = useVdot();
  const [index, setIndex] = useState(0);
  const [forward, setForward] = useState(true);
  const existingHr = useHrProfile();
  const [heart, setHeart] = useState<HrProfileInput>(() => defaultHeartInput(existingHr));
  const [units, setUnits] = useState<UnitPrefs>(settings.units);
  const [zones, setZones] = useZonesDraft();
  const [choice, setChoice] = useState<PlanChoice | undefined>(plan?.presetId);
  const [canRun20, setCanRun20] = useState<boolean | undefined>(plan ? !presetInfo(plan.presetId).beginner : undefined);
  const flow: readonly Step[] = only === 'zones' ? ['zones'] : only === 'plan' ? planSteps(choice) : ['units', 'heart', ...planSteps(choice)];
  const [inputs, setInputs] = useState<PlanInputs | undefined>(plan ? { ...plan.inputs } : undefined);
  // The repo's message for inputs it rejected; editing the inputs clears it.
  const [rejected, setRejected] = useState<{ inputs: PlanInputs; message: string }>();
  const step = flow[index]!;

  const finish = () => {
    if (!only) actions.updateSettings({ onboarded: true });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const next = () => {
    if (step === 'units') actions.updateSettings({ units });
    if (step === 'heart') actions.saveHrProfile(heart);
    if (step === 'zones') {
      actions.saveHrProfile(zones.input);
      if (only) {
        haptic.success();
        showSnack({ message: 'Heart rate zones saved' });
        return finish();
      }
    }
    if (step === 'pick') {
      if (choice === 'none') {
        if (only) actions.abandonPlan();
        return finish();
      }
      if (choice && inputs?.presetId !== choice) setInputs({ ...defaultInputs(choice, today, vdot), fitness: inputs?.fitness ?? defaultFitness(units.distance) });
      else if (inputs && !inputs.fitness) setInputs({ ...inputs, fitness: defaultFitness(units.distance) });
    }
    if (index === flow.length - 1 && inputs) {
      let created;
      try {
        created = actions.createPlan(inputs);
      } catch (e) {
        haptic.warn();
        return setRejected({ inputs, message: e instanceof Error ? e.message : String(e) });
      }
      haptic.success();
      showSnack({ message: `${created.name} plan created, ${created.weeks} weeks` });
      return finish();
    }
    setForward(true);
    setIndex(index + 1);
  };

  const back = () => {
    if (index > 0) {
      setForward(false);
      setIndex(index - 1);
    }
    else if (router.canGoBack()) router.back();
  };

  const last = index === flow.length - 1;
  const problem =
    (step === 'details' || step === 'pace') && inputs
      ? (inputsProblem(inputs) ?? (rejected?.inputs === inputs ? rejected.message : undefined))
      : step === 'zones'
        ? zones.error
        : step === 'run20' && canRun20 === undefined
          ? 'Pick an answer'
          : step === 'pick' && !choice
            ? 'Pick a plan'
            : undefined;
  const cta = (step === 'details' || step === 'pace') && last ? 'Create plan' : step === 'pick' && choice === 'none' ? 'Finish' : step === 'fitness' ? 'Next: run days' : step === 'details' ? 'Next: paces' : step === 'zones' && only ? 'Save' : 'Continue';
  const canBack = index > 0 || router.canGoBack();

  return (
    <View style={[s.screen, { paddingTop: insets.top + 12 }]}>
      <View style={s.top}>
        {canBack ? (
          <IconButton label="Back" size={40} onPress={back}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
        ) : (
          <View style={{ width: 40 }} />
        )}
        <View style={s.bars}>
          {flow.map((st, i) => (
            <View key={st} style={[s.bar, { backgroundColor: i <= index ? p.primary : p.border }]} />
          ))}
        </View>
        <T v="caption" tone="secondary">{`${index + 1} of ${flow.length}`}</T>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Animated.View key={step} entering={(forward ? FadeInRight : FadeInLeft).duration(SLIDE_MS)}>
          {step === 'units' && <UnitsStep units={units} onChange={setUnits} />}
          {step === 'heart' && <HeartStep input={heart} onChange={setHeart} />}
          {step === 'zones' && <ZonesStep draft={zones} onChange={setZones} />}
          {step === 'run20' && <Run20Step answer={canRun20} onAnswer={setCanRun20} />}
          {step === 'pick' && <PlanPickStep choice={choice} onChoose={setChoice} canRun20={canRun20} />}
          {step === 'fitness' && inputs?.fitness && <FitnessStep fitness={inputs.fitness} unit={units.distance} onChange={(fitness) => setInputs({ ...inputs, fitness })} />}
          {step === 'details' && inputs && <PlanDetailsStep inputs={inputs} onChange={setInputs} today={today} />}
          {step === 'pace' && inputs && <PaceStep inputs={inputs} onChange={setInputs} vdot={vdot} />}
        </Animated.View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {problem && step !== 'zones' && (
          <T v="caption" tone="secondary" align="center">
            {problem}
          </T>
        )}
        <Button label={cta} disabled={!!problem} onPress={next} />
      </View>
    </View>
  );
}

function UnitsStep({ units, onChange }: { units: UnitPrefs; onChange: (u: UnitPrefs) => void }) {
  return (
    <View style={{ gap: 18 }}>
      <View>
        <T v="display" style={{ fontSize: 26 }} accessibilityRole="header">
          Units
        </T>
        <T v="body" tone="secondary" style={{ marginTop: 6, fontSize: 14, lineHeight: 20 }}>
          How distances, paces and weights are shown. You can change this later in Settings.
        </T>
      </View>
      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Distance
        </T>
        <Segmented
          look="inset"
          options={[
            { value: 'mi', label: 'Miles' },
            { value: 'km', label: 'Kilometers' },
          ]}
          value={units.distance}
          onChange={(distance) => onChange({ ...units, distance })}
        />
      </View>
      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Weight
        </T>
        <Segmented
          look="inset"
          options={[
            { value: 'lb', label: 'Pounds' },
            { value: 'kg', label: 'Kilograms' },
          ]}
          value={units.weight}
          onChange={(weight) => onChange({ ...units, weight })}
        />
      </View>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  bars: { flex: 1, flexDirection: 'row', gap: 4 },
  bar: { flex: 1, height: 4, borderRadius: 2 },
  body: { padding: 20, paddingTop: 18, gap: 18 },
  footer: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
}));
