import { type PlanInputs, type UnitPrefs } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { actions, showSnack, usePlan, useSettings, useToday } from '@/data/store';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, Segmented, T } from '@/ui/primitives';
import { type PlanChoice, PlanDetailsStep, PlanPickStep, defaultInputs, inputsProblem } from './PlanSteps';
import { ZonesStep, useZonesDraft } from './ZonesStep';
import { haptic } from '@/lib/haptics';

type Step = 'units' | 'zones' | 'pick' | 'details';
const FULL: readonly Step[] = ['units', 'zones', 'pick', 'details'];

/**
 * First-launch setup (units, heart rate zones, running plan). Also opened from Settings
 * with `only=zones` or `only=plan` to change one part.
 */
export function SetupScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { only } = useLocalSearchParams<{ only?: 'zones' | 'plan' }>();
  const flow: readonly Step[] = only === 'zones' ? ['zones'] : only === 'plan' ? ['pick', 'details'] : FULL;
  const settings = useSettings();
  const today = useToday();
  const plan = usePlan();
  const [index, setIndex] = useState(0);
  const [units, setUnits] = useState<UnitPrefs>(settings.units);
  const [zones, setZones] = useZonesDraft();
  const [choice, setChoice] = useState<PlanChoice | undefined>(plan?.presetId);
  const [inputs, setInputs] = useState<PlanInputs | undefined>(plan ? { ...plan.inputs } : undefined);
  const step = flow[index]!;
  const fullIndex = FULL.indexOf(step);

  const finish = () => {
    if (!only) actions.updateSettings({ onboarded: true });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const next = () => {
    if (step === 'units') actions.updateSettings({ units });
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
      if (choice && inputs?.presetId !== choice) setInputs(defaultInputs(choice, today));
    }
    if (step === 'details' && inputs) {
      const created = actions.createPlan(inputs);
      haptic.success();
      showSnack({ message: `${created.name} plan created, ${created.weeks} weeks` });
      return finish();
    }
    setIndex(index + 1);
  };

  const back = () => {
    if (index > 0) setIndex(index - 1);
    else if (router.canGoBack()) router.back();
  };

  const problem = step === 'details' && inputs ? inputsProblem(inputs) : step === 'zones' ? zones.error : step === 'pick' && !choice ? 'Pick a plan' : undefined;
  const cta = step === 'details' ? 'Create plan' : step === 'pick' ? (choice === 'none' ? 'Finish' : 'Next: run days') : step === 'zones' && only ? 'Save' : 'Continue';
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
          {FULL.map((st, i) => (
            <View key={st} style={[s.bar, { backgroundColor: i <= fullIndex ? p.primary : p.border }]} />
          ))}
        </View>
        <T v="caption" tone="secondary">{`${fullIndex + 1} of 4`}</T>
      </View>

      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {step === 'units' && <UnitsStep units={units} onChange={setUnits} />}
        {step === 'zones' && <ZonesStep draft={zones} onChange={setZones} />}
        {step === 'pick' && <PlanPickStep choice={choice} onChoose={setChoice} />}
        {step === 'details' && inputs && <PlanDetailsStep inputs={inputs} onChange={setInputs} today={today} />}
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
