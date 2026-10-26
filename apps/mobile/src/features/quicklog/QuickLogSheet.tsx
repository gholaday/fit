import { type IsoDate, type QuickLogType, addDays, diffDays, formatMinutes, unitToMeters } from '@fit/core';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { actions, showSnack, useToday, useUnits } from '@/data/store';
import { useFormStyles } from '@/features/items/ItemSheet';
import { shortDate } from '@/lib/format';
import { usePalette } from '@/theme';
import { Button, Group, IconButton, Row, Stepper, T, NumStepper } from '@/ui/primitives';
import { Icons, QUICK_LOG_ICON } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';
import { haptic } from '@/lib/haptics';

const TYPES: readonly { value: QuickLogType; label: string }[] = [
  { value: 'walk', label: 'Walk' },
  { value: 'hike', label: 'Hike' },
  { value: 'bike', label: 'Bike' },
  { value: 'swim', label: 'Swim' },
  { value: 'run', label: 'Run' },
  { value: 'lift', label: 'Workout' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'other', label: 'Other' },
];

export const quickLogLabel = (type: QuickLogType) => TYPES.find((t) => t.value === type)!.label;

const DEFAULT_MINUTES: Record<QuickLogType, number> = { walk: 30, hike: 90, bike: 45, swim: 30, run: 30, lift: 45, stretch: 15, other: 30 };

/** Unplanned activity: type, date, minutes, optional distance and note. Never changes the plan. */
export function QuickLogSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Quick log" scroll>
      {visible && <Form onClose={onClose} />}
    </Sheet>
  );
}

function dateLabel(date: IsoDate, today: IsoDate): string {
  const d = diffDays(date, today);
  if (d === 0) return `Today, ${shortDate(date)}`;
  if (d === 1) return `Yesterday, ${shortDate(date)}`;
  return shortDate(date);
}

function Form({ onClose }: { onClose: () => void }) {
  const p = usePalette();
  const f = useFormStyles();
  const today = useToday();
  const units = useUnits();
  const [kind, setKind] = useState<QuickLogType>('walk');
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES.walk);
  const [touchedMinutes, setTouchedMinutes] = useState(false);
  const [distance, setDistance] = useState(0);
  const [note, setNote] = useState('');

  const pick = (t: QuickLogType) => {
    haptic.tick();
    setKind(t);
    if (!touchedMinutes) setMinutes(DEFAULT_MINUTES[t]);
  };
  const step = (delta: number) => {
    setTouchedMinutes(true);
    setMinutes(Math.max(5, minutes + delta));
  };
  const save = () => {
    const label = TYPES.find((t) => t.value === kind)!.label;
    actions.addQuickLog({
      date,
      activityType: kind,
      minutes,
      distanceM: distance > 0 ? unitToMeters(distance, units.distance) : undefined,
      note: note.trim() || undefined,
    });
    haptic.commit();
    onClose();
    showSnack({ message: `${label} saved, ${formatMinutes(minutes * 60)}` });
  };

  return (
    <>
      <View style={{ gap: 8 }}>
        {[TYPES.slice(0, 4), TYPES.slice(4)].map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
            {row.map((t) => {
              const on = t.value === kind;
              const Icon = QUICK_LOG_ICON[t.value];
              const fg = on ? p.onPrimary : p.textBody;
              return (
                <Pressable
                  key={t.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => pick(t.value)}
                  style={{ flex: 1, height: 68, borderRadius: 14, backgroundColor: on ? p.primary : p.inset, alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <Icon size={22} color={fg} />
                  <T v="captionMedium" color={fg}>
                    {t.label}
                  </T>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <Group style={{ borderWidth: 1, borderColor: p.outline }}>
        <Row label="Date">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton label="Day before" bg="none" onPress={() => {
                haptic.tick();
                setDate(addDays(date, -1));
              }}>
              <Icons.chevronLeft size={18} color={p.text} />
            </IconButton>
            <T v="bodyStrong" num>
              {dateLabel(date, today)}
            </T>
            <IconButton label="Day after" bg="none" disabled={date >= today} style={{ opacity: date >= today ? 0.3 : 1 }} onPress={() => {
                haptic.tick();
                setDate(addDays(date, 1));
              }}>
              <Icons.chevronRight size={18} color={p.text} />
            </IconButton>
          </View>
        </Row>
        <Row label="Duration">
          <Stepper value={formatMinutes(minutes * 60)} minusLabel="Less time" plusLabel="More time" onMinus={() => step(-5)} onPlus={() => step(5)} />
        </Row>
        <Row label="Distance">
          <NumStepper label="Distance" value={distance} min={0} max={100} step={0.1} format={(n) => (n === 0 ? 'None' : `${n.toFixed(1)} ${units.distance}`)} onChange={setDistance} />
        </Row>
        <View style={{ padding: 16, gap: 8 }}>
          <T v="bodyMedium">Note</T>
          <TextInput value={note} onChangeText={setNote} placeholder="Optional" placeholderTextColor={p.textTertiary} style={f.input} accessibilityLabel="Note" />
        </View>
      </Group>

      <T v="caption" tone="secondary">
        Counts toward weekly totals. Doesn't change your plan.
      </T>
      <Button label="Save" onPress={save} />
    </>
  );
}
