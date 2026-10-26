import { DEFAULT_HR_METHOD, type HrMethod, type HrProfileInput, type HrZoneBand, ZONE_NAMES, computeZones, estimateMaxHr } from '@fit/core';
import { type ReactNode, cloneElement, isValidElement, useState } from 'react';
import { View } from 'react-native';
import { useHrProfile } from '@/data/store';
import { createStyles, usePalette } from '@/theme';
import { Chip, Group, NumStepper, Row, Segmented, T } from '@/ui/primitives';

const METHODS: readonly { value: HrMethod; label: string }[] = [
  { value: 'hrr', label: 'HR reserve' },
  { value: 'max', label: '% of max' },
  { value: 'maf', label: 'MAF' },
  { value: 'lthr', label: 'Threshold' },
];

const METHOD_NOTE: Record<HrMethod, string> = {
  hrr: 'Karvonen: zones from the range between resting and max heart rate.',
  max: 'Zones as a share of max heart rate.',
  maf: '180 minus age. Zone 2 tops out at your MAF number.',
  lthr: 'From a 30-minute test. Zone 2 is 80-89% of threshold heart rate.',
  custom: '',
};

export interface ZonesDraft {
  input: HrProfileInput;
  zones: HrZoneBand[] | undefined;
  error: string | undefined;
}

export function draftZones(input: HrProfileInput): ZonesDraft {
  try {
    return { input, zones: computeZones(input), error: undefined };
  } catch (e) {
    return { input, zones: undefined, error: e instanceof Error ? e.message : 'Check the values' };
  }
}

export function useZonesDraft(): [ZonesDraft, (input: HrProfileInput) => void] {
  const existing = useHrProfile();
  const [draft, setDraft] = useState(() =>
    draftZones(existing ? { method: existing.method, maxHr: existing.maxHr, maxHrSource: existing.maxHrSource, restingHr: existing.restingHr, lthr: existing.lthr, age: existing.age, mafAdjust: existing.mafAdjust } : { method: DEFAULT_HR_METHOD, age: 35, maxHr: estimateMaxHr(35), maxHrSource: 'estimated', restingHr: 60 }),
  );
  return [draft, (input) => setDraft(draftZones(input))];
}

export function ZonesStep({ draft, onChange }: { draft: ZonesDraft; onChange: (input: HrProfileInput) => void }) {
  const s = useStyles();
  const p = usePalette();
  const i = draft.input;
  const set = (patch: Partial<HrProfileInput>) => onChange({ ...i, ...patch });
  const setAge = (age: number) => {
    // An estimated max follows age; a max you set stays put.
    if (i.maxHrSource !== 'measured') set({ age, maxHr: estimateMaxHr(age), maxHrSource: 'estimated' });
    else set({ age });
  };
  const usesMax = i.method === 'hrr' || i.method === 'max';
  const rows: ReactNode[] = [];
  if (i.method !== 'lthr')
    rows.push(
      <Row key="age" label="Age" sub={i.method === 'maf' ? 'Sets your MAF number' : 'Used to estimate max heart rate'}>
        <NumStepper label="Age" value={i.age ?? 35} min={13} max={90} format={(n) => `${n} yr`} onChange={setAge} />
      </Row>,
    );
  if (i.method === 'hrr')
    rows.push(
      <Row key="rest" label="Resting heart rate" sub="Morning, before getting up">
        <NumStepper label="Resting heart rate" value={i.restingHr ?? 60} min={30} max={110} format={(n) => `${n} bpm`} onChange={(restingHr) => set({ restingHr })} />
      </Row>,
    );
  if (usesMax)
    rows.push(
      <Row key="max" label="Max heart rate" sub={i.maxHrSource === 'measured' ? 'Set by you' : 'Estimated from age, change it if you know it'}>
        <NumStepper label="Max heart rate" value={i.maxHr ?? estimateMaxHr(i.age ?? 35)} min={120} max={220} format={(n) => `${n} bpm`} onChange={(maxHr) => set({ maxHr, maxHrSource: 'measured' })} />
      </Row>,
    );
  if (i.method === 'lthr')
    rows.push(
      <Row key="lthr" label="Threshold heart rate" sub="Average of the last 20 minutes of a 30-minute test">
        <NumStepper label="Threshold heart rate" value={i.lthr ?? 165} min={100} max={210} format={(n) => `${n} bpm`} onChange={(lthr) => set({ lthr })} />
      </Row>,
    );
  if (i.method === 'maf')
    rows.push(
      <View key="adj" style={s.adjust}>
        <T v="bodyMedium">Adjustment</T>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[-5, 0, 5].map((n) => (
            <Chip key={n} label={n === 0 ? 'None' : `${n > 0 ? '+' : ''}${n} bpm`} on={(i.mafAdjust ?? 0) === n} onPress={() => set({ mafAdjust: n })} />
          ))}
        </View>
      </View>,
    );

  return (
    <View style={{ gap: 18 }}>
      <View>
        <T v="display" style={{ fontSize: 26 }} accessibilityRole="header">
          Heart rate zones
        </T>
        <T v="body" tone="secondary" style={{ marginTop: 6, fontSize: 14, lineHeight: 20 }}>
          Used for heart rate targets on any run step, and for stats. You can change them later in Settings.
        </T>
      </View>

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Method
        </T>
        <Segmented look="inset" options={METHODS} value={i.method} onChange={(method) => set({ method })} />
        <T v="caption" tone="secondary">
          {METHOD_NOTE[i.method]}
        </T>
      </View>

      <Group>{rows.map((r, idx) => (idx === rows.length - 1 && isValidElement<{ last?: boolean }>(r) && r.type === Row ? cloneElement(r, { last: true }) : r))}</Group>

      {draft.error ? (
        <T v="label" tone="secondary">
          {draft.error}
        </T>
      ) : (
        <View style={{ gap: 6 }}>
          {draft.zones!.map((z) => {
            const on = z.zone === 2;
            return (
              <View key={z.zone} style={[s.zone, on && { backgroundColor: p.run.tint, borderColor: p.run.color, borderWidth: 1.5 }]}>
                <T v="labelStrong" color={on ? p.run.onTint : p.textSecondary} style={{ width: 28 }}>
                  {`Z${z.zone}`}
                </T>
                <T v="body" style={{ flex: 1, fontSize: 14 }} color={on ? p.text : p.textBody}>
                  {ZONE_NAMES[z.zone]}
                </T>
                <T v="bodyStrong" num>
                  {`${z.minBpm}-${z.maxBpm} bpm`}
                </T>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  zone: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: p.surface },
  adjust: { padding: 16, gap: 10 },
}));
