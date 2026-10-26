import { type IsoDate, type QuickLogType, addDays, diffDays, formatMinutes, unitToMeters } from '@fit/core';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { actions, showSnack, useToday, useUnits } from '@/data/store';
import { useFormStyles } from '@/features/items/ItemSheet';
import { shortDate } from '@/lib/format';
import { usePalette } from '@/theme';
import { Button, Group, IconButton, Row, Stepper, T } from '@/ui/primitives';
import { Icons, QUICK_LOG_ICON } from '@/ui/icons';
import { Sheet } from '@/ui/Sheet';

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
  const [distance, setDistance] = useState('');
  const [note, setNote] = useState('');

  const pick = (t: QuickLogType) => {
    setKind(t);
    if (!touchedMinutes) setMinutes(DEFAULT_MINUTES[t]);
  };
  const step = (delta: number) => {
    setTouchedMinutes(true);
    setMinutes(Math.max(5, minutes + delta));
  };
  const save = () => {
    const d = Number(distance.replace(',', '.'));
    const label = TYPES.find((t) => t.value === kind)!.label;
    actions.addQuickLog({
      date,
      activityType: kind,
      minutes,
      distanceM: distance.trim() !== '' && Number.isFinite(d) && d > 0 ? unitToMeters(d, units.distance) : undefined,
      note: note.trim() || undefined,
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onClose();
    showSnack({ message: `${label} saved, ${formatMinutes(minutes * 60)}` });
  };

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {TYPES.map((t) => {
          const on = t.value === kind;
          const Icon = QUICK_LOG_ICON[t.value];
          const fg = on ? p.onPrimary : p.textBody;
          return (
            <Pressable
              key={t.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => pick(t.value)}
              style={{ width: '23.5%', height: 68, borderRadius: 14, backgroundColor: on ? p.primary : p.inset, alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Icon size={22} color={fg} />
              <T v="captionMedium" color={fg}>
                {t.label}
              </T>
            </Pressable>
          );
        })}
      </View>

      <Group style={{ borderWidth: 1, borderColor: p.outline }}>
        <Row label="Date">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton label="Day before" bg="none" onPress={() => setDate(addDays(date, -1))}>
              <Icons.chevronLeft size={18} color={p.text} />
            </IconButton>
            <T v="bodyStrong" num>
              {dateLabel(date, today)}
            </T>
            <IconButton label="Day after" bg="none" disabled={date >= today} style={{ opacity: date >= today ? 0.3 : 1 }} onPress={() => setDate(addDays(date, 1))}>
              <Icons.chevronRight size={18} color={p.text} />
            </IconButton>
          </View>
        </Row>
        <Row label="Duration">
          <Stepper value={formatMinutes(minutes * 60)} minusLabel="Less time" plusLabel="More time" onMinus={() => step(-5)} onPlus={() => step(5)} />
        </Row>
        <Row label="Distance">
          <View style={f.inputWrap}>
            <TextInput value={distance} onChangeText={setDistance} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={p.textTertiary} style={[f.input, { width: 90, textAlign: 'right' }]} accessibilityLabel={`Distance in ${units.distance}`} />
            <T v="body" tone="secondary">
              {units.distance}
            </T>
          </View>
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
