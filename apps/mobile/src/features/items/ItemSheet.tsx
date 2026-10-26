import { type AgendaItem, type IsoDate, type SkipReason, addDays, dateRange, formatMinutes, metersToUnit, startOfWeek, unitToMeters, weekdayOf } from '@fit/core';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { actions, showSnack, useFit, useUnits } from '@/data/store';
import { evaluate, startMove } from '@/features/move/moveFlow';
import { Note } from '@/features/move/MoveFlowHost';
import { monthDay, weekdayShort } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { type as typeRamp } from '@/theme/type';
import { Button, Chip, Group, LaneTile, Row, Stepper, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { dayName, isPast, plannedLine } from './meta';

export type ItemSheetMode = 'actions' | 'details' | 'skip' | 'move';

export const useItemSheet = create<{ key: string | undefined; mode: ItemSheetMode }>()(() => ({ key: undefined, mode: 'actions' }));

export function openItemSheet(key: string, mode: ItemSheetMode = 'actions'): void {
  useItemSheet.setState({ key, mode });
}

function close(): void {
  useItemSheet.setState({ key: undefined });
}

/** Done with one tap, with haptic and Undo. */
export function markDoneNow(item: AgendaItem): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  actions.markDone(item.key);
  showSnack({ message: `${item.title} done`, actionLabel: 'Undo', onAction: () => actions.reopen(item.key) });
}

export function ItemSheetHost() {
  const { key, mode } = useItemSheet();
  const item = useFit((s) => (key ? s.items[key] : undefined));
  if (!key || !item) return null;
  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <LaneTile lane={item.lane} size={40} />
      <View style={{ flex: 1 }}>
        <T v="sheetTitle" numberOfLines={1}>
          {mode === 'move' ? `Move ${item.title}` : mode === 'skip' ? `Skip ${item.title}` : item.title}
        </T>
        <T v="label" tone="secondary" style={{ fontWeight: '400' }}>
          {plannedLine(item)}
        </T>
      </View>
    </View>
  );
  return (
    <Sheet visible onClose={close} header={header} scroll={mode === 'move' || mode === 'details'}>
      {mode === 'actions' && <Actions item={item} />}
      {mode === 'details' && <Details item={item} />}
      {mode === 'skip' && <Skip item={item} />}
      {mode === 'move' && <MovePicker item={item} />}
    </Sheet>
  );
}

function Actions({ item }: { item: AgendaItem }) {
  const today = useFit((s) => s.today);
  const tomorrow = addDays(today, 1);
  const go = (mode: ItemSheetMode) => useItemSheet.setState({ mode });
  if (item.status !== 'pending') {
    return (
      <View style={{ gap: 8 }}>
        {item.status === 'done' && <Button label="Edit details" kind="outline" onPress={() => go('details')} />}
        <Button
          label={item.status === 'done' ? 'Mark not done' : 'Undo skip'}
          kind="outline"
          onPress={() => {
            close();
            actions.reopen(item.key);
          }}
        />
        <Button label="Move to another day" kind="outline" onPress={() => go('move')} />
      </View>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Button
        label="Done"
        onPress={() => {
          close();
          markDoneNow(item);
        }}
      />
      <Button label="Done with details" kind="outline" onPress={() => go('details')} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Skip" kind="outline" style={{ flex: 1 }} onPress={() => go('skip')} />
        {item.date !== tomorrow && (
          <Button
            label="Move to tomorrow"
            kind="outline"
            style={{ flex: 2 }}
            onPress={() => {
              close();
              startMove(item.key, tomorrow);
            }}
          />
        )}
      </View>
      <Button label="Move to another day" kind="quiet" onPress={() => go('move')} />
    </View>
  );
}

const REASONS: readonly { value: SkipReason; label: string }[] = [
  { value: 'sick', label: 'Sick' },
  { value: 'busy', label: 'Busy' },
  { value: 'sore', label: 'Sore' },
  { value: 'other', label: 'Other' },
];

function Skip({ item }: { item: AgendaItem }) {
  const [reason, setReason] = useState<SkipReason | undefined>();
  return (
    <View style={{ gap: 14 }}>
      <T v="label" tone="secondary">
        Reason, optional
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {REASONS.map((r) => (
          <Chip key={r.value} label={r.label} on={reason === r.value} onPress={() => setReason(reason === r.value ? undefined : r.value)} />
        ))}
      </View>
      <Button
        label="Skip"
        onPress={() => {
          close();
          actions.skip(item.key, reason);
          showSnack({ message: `${item.title} skipped`, actionLabel: 'Undo', onAction: () => actions.reopen(item.key) });
        }}
      />
    </View>
  );
}

function Details({ item }: { item: AgendaItem }) {
  const units = useUnits();
  const s = useFormStyles();
  const p = usePalette();
  const [minutes, setMinutes] = useState(item.details?.minutes ?? Math.max(1, Math.round(item.estSeconds / 60)));
  const [distance, setDistance] = useState(item.details?.distanceM ? metersToUnit(item.details.distanceM, units.distance).toFixed(2) : '');
  const [rpe, setRpe] = useState<number | undefined>(item.details?.rpe);
  const [note, setNote] = useState(item.details?.note ?? '');
  const save = () => {
    const d = Number(distance.replace(',', '.'));
    const details = {
      minutes,
      distanceM: distance.trim() !== '' && Number.isFinite(d) && d > 0 ? unitToMeters(d, units.distance) : undefined,
      rpe,
      note: note.trim() || undefined,
    };
    close();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const wasDone = item.status === 'done';
    actions.markDone(item.key, details);
    showSnack({ message: wasDone ? 'Details saved' : `${item.title} done`, actionLabel: wasDone ? undefined : 'Undo', onAction: wasDone ? undefined : () => actions.reopen(item.key) });
  };
  return (
    <View style={{ gap: 14 }}>
      <Group style={{ borderWidth: 1, borderColor: p.outline }}>
        <Row label="Duration">
          <Stepper value={formatMinutes(minutes * 60)} minusLabel="Less time" plusLabel="More time" onMinus={() => setMinutes(Math.max(1, minutes - 5))} onPlus={() => setMinutes(minutes + 5)} />
        </Row>
        <Row label="Distance">
          <View style={s.inputWrap}>
            <TextInput value={distance} onChangeText={setDistance} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={p.textTertiary} style={[s.input, { width: 80, textAlign: 'right' }]} accessibilityLabel={`Distance in ${units.distance}`} />
            <T v="body" tone="secondary">
              {units.distance}
            </T>
          </View>
        </Row>
        <View style={{ padding: 16, gap: 10 }}>
          <T v="bodyMedium">Effort, RPE 1-10</T>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`RPE ${n}`}
                accessibilityState={{ selected: rpe === n }}
                onPress={() => setRpe(rpe === n ? undefined : n)}
                style={[s.rpe, rpe === n && { backgroundColor: p.primary }]}
              >
                <T v="labelStrong" num color={rpe === n ? p.onPrimary : p.textBody}>
                  {n}
                </T>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
          <T v="bodyMedium">Note</T>
          <TextInput value={note} onChangeText={setNote} placeholder="How it went" placeholderTextColor={p.textTertiary} style={s.input} accessibilityLabel="Note" />
        </View>
      </Group>
      <Button label="Save" onPress={save} />
    </View>
  );
}

export const useFormStyles = createStyles((p) => ({
  input: { ...typeRamp.body, color: p.text, height: 40, borderRadius: 10, backgroundColor: p.inset, paddingHorizontal: 12, paddingVertical: 0 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rpe: { flex: 1, height: 36, borderRadius: 10, backgroundColor: p.inset, alignItems: 'center', justifyContent: 'center' },
}));

/** Move.html: this week and next, each day showing what is already on it. */
function MovePicker({ item }: { item: AgendaItem }) {
  const today = useFit((s) => s.today);
  const [selected, setSelected] = useState<IsoDate | undefined>();
  const monday = startOfWeek(today);
  const weeks = [
    { label: 'This week', days: dateRange(monday, addDays(monday, 6)) },
    { label: 'Next week', days: dateRange(addDays(monday, 7), addDays(monday, 13)) },
  ];
  const evaluation = selected ? evaluate(item.key, selected) : undefined;
  return (
    <View style={{ gap: 14 }}>
      {weeks.map((w) => (
        <View key={w.label} style={{ gap: 6 }}>
          <T v="captionStrong" tone="secondary">
            {w.label}
          </T>
          {w.days.map((d) => (
            <DayOption key={d} date={d} item={item} today={today} selected={selected === d} onPress={() => setSelected(d)} />
          ))}
        </View>
      ))}
      {selected && evaluation && <Note text={moveNote(item, selected, evaluation, today)} />}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Cancel" kind="outline" style={{ width: 104 }} onPress={close} />
        <Button
          label={selected ? `Move to ${dayName(selected, today)}` : 'Pick a day'}
          disabled={!selected}
          style={{ flex: 1 }}
          onPress={() => {
            if (!selected) return;
            close();
            startMove(item.key, selected);
          }}
        />
      </View>
    </View>
  );
}

function moveNote(item: AgendaItem, date: IsoDate, e: ReturnType<typeof evaluate>, today: IsoDate): string {
  const day = dayName(date, today);
  const items = useFit.getState().items;
  if (e.warnings.length > 0) {
    const other = items[e.warnings[0]!.otherKey];
    const sugg = e.suggestion ? items[e.suggestion.withKey] : undefined;
    const base = `Back-to-back hard days with ${other?.title ?? 'another hard run'} on ${other ? dayName(other.date, today) : 'the next day'}.`;
    return sugg ? `${base} Swapping with ${sugg.title} on ${dayName(sugg.date, today)} avoids it.` : base;
  }
  const occupant = e.occupants[0];
  if (occupant) return `${day} has ${occupant.title}. You can swap or put both on.`;
  return `${day} is open for ${item.title}.`;
}

function DayOption({ date, item, today, selected, onPress }: { date: IsoDate; item: AgendaItem; today: IsoDate; selected: boolean; onPress: () => void }) {
  const s = usePickerStyles();
  const others = useFit(useShallow((st) => (st.byDate[date] ?? []).map((k) => st.items[k]!).filter((i) => i.key !== item.key)));
  const main = others.filter((i) => i.lane !== 'stretch').map((i) => i.title);
  const on = main.length > 0 ? main.join(', ') : others.length > 0 ? 'Stretch only' : 'Open';
  const current = date === item.date;
  const occupied = others.some((i) => i.lane === item.lane && i.lane !== 'stretch');
  const past = isPast(date, today);
  const tag = selected ? 'Selected' : current ? 'Planned here' : past ? 'Past' : occupied ? 'Swap or add' : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: current }}
      accessibilityLabel={`${weekdayShort(weekdayOf(date))} ${monthDay(date)}, ${on}`}
      disabled={current}
      onPress={onPress}
      style={[s.row, selected && s.selected, past && !selected && { opacity: 0.45 }]}
    >
      <View style={{ width: 54 }}>
        <T v="labelStrong" style={{ fontSize: 14 }}>
          {weekdayShort(weekdayOf(date))}
        </T>
        <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
          {monthDay(date)}
        </T>
      </View>
      <T v="label" tone="body" style={{ flex: 1, fontWeight: '400' }} numberOfLines={1}>
        {on}
      </T>
      <T v="captionMedium" tone={selected ? 'text' : 'tertiary'}>
        {tag}
      </T>
    </Pressable>
  );
}

const usePickerStyles = createStyles((p) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: p.bg },
  selected: { backgroundColor: p.surface, borderWidth: 1.5, borderColor: p.primary },
}));
