import { type PlanSummary, type Routine, type ScheduleEntry, type ScheduleSlot, type Weekday } from '@fit/core';
import { router } from 'expo-router';
import { memo, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { actions, showSnack, usePlan, useRoutines, useSchedule, useToday } from '@/data/store';
import { clockTime, hhmm, list, minutesOf, monthDay, weekdayLong, weekdayShort } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { type ActivityColor, createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Group, LaneTile, Row, Segmented, Stepper, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

const WEEK: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const SLOT_ORDER: Record<ScheduleSlot, number> = { morning: 0, any: 1, evening: 2 };
const DEFAULT_TIME: Record<ScheduleSlot, string> = { morning: '07:00', any: '18:00', evening: '21:00' };

/** Run days the plan uses (read-only here; changed through Manage). */
function runDays(plan: PlanSummary | undefined): Map<Weekday, 'Run' | 'Long run'> {
  const out = new Map<Weekday, 'Run' | 'Long run'>();
  if (!plan) return out;
  const { preferredDays, daysPerWeek, longRunDay } = plan.inputs;
  const days = [...preferredDays].sort((a, b) => a - b).slice(0, daysPerWeek);
  if (!days.includes(longRunDay)) days[days.length - 1] = longRunDay;
  for (const d of days) out.set(d, d === longRunDay ? 'Long run' : 'Run');
  return out;
}

/** Workouts first, then stretches by part of day, as in the mockups. */
function sortEntries(entries: readonly ScheduleEntry[], routines: readonly Routine[]): ScheduleEntry[] {
  const kind = (e: ScheduleEntry) => (routines.find((r) => r.id === e.routineId)?.kind === 'strength' ? 0 : 1);
  return [...entries].sort((a, b) => kind(a) - kind(b) || SLOT_ORDER[a.slot ?? 'any'] - SLOT_ORDER[b.slot ?? 'any'] || (a.time ?? '').localeCompare(b.time ?? '') || a.position - b.position);
}

function chipLabel(entry: ScheduleEntry, routine: Routine): string {
  const name = routine.kind === 'stretch' ? routine.name.replace(/ stretch$/, '') : routine.name;
  return entry.time ? `${name}, ${clockTime(entry.time)}` : name;
}

export function ScheduleTab() {
  const s = useStyles();
  const p = usePalette();
  const plan = usePlan();
  const schedule = useSchedule();
  const routines = useRoutines();
  const [editing, setEditing] = useState<{ weekday: Weekday; entryId?: string } | undefined>();
  const runs = runDays(plan);

  return (
    <View style={{ gap: 14 }}>
      <PlanSummaryCard plan={plan} runs={runs} />

      <View style={s.sectionHead}>
        <T v="bodyStrong" accessibilityRole="header">
          Every week
        </T>
        <T v="caption" tone="secondary">
          Tap a day to edit
        </T>
      </View>

      <View style={{ gap: 6 }}>
        {WEEK.map((w) => (
          <ScheduleDay
            key={w}
            weekday={w}
            run={runs.get(w)}
            entries={sortEntries(schedule.filter((e) => e.weekday === w), routines)}
            routines={routines}
            onEdit={(entryId) => {
              haptic.tick();
              setEditing({ weekday: w, entryId });
            }}
          />
        ))}
      </View>

      <View style={s.legend}>
        <Legend color={p.run.color} label="Run, from plan" />
        <Legend color={p.strength.color} label="Workout" />
        <Legend color={p.stretch.color} label="Stretch" />
      </View>

      <DayEditor editing={editing} onChange={setEditing} />
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
        {label}
      </T>
    </View>
  );
}

function PlanSummaryCard({ plan, runs }: { plan: PlanSummary | undefined; runs: Map<Weekday, string> }) {
  const s = useStyles();
  const today = useToday();
  const manage = () => router.push({ pathname: '/setup', params: { only: 'plan' } });
  if (!plan) {
    return (
      <View style={s.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <LaneTile lane="run" />
          <View style={{ flex: 1 }}>
            <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
              Running plan
            </T>
            <T v="headline">None</T>
          </View>
          <Button label="Pick a plan" kind="outline" size="sm" onPress={manage} />
        </View>
      </View>
    );
  }
  const days = [...runs.keys()].sort((a, b) => a - b);
  return (
    <View style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <LaneTile lane="run" />
        <View style={{ flex: 1 }}>
          <T v="micro" tone="secondary" style={{ fontWeight: '400' }}>
            Running plan
          </T>
          <T v="headline">{plan.name}</T>
        </View>
        <Button label="Manage" kind="outline" size="sm" onPress={manage} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {today < plan.startDate ? <Fact value={monthDay(plan.startDate)} label="Starts" /> : <Fact value={`Week ${plan.currentWeek} of ${plan.weeks}`} label="Progress" />}
        <Fact value={`${days.length} days`} label={list(days.map(weekdayShort))} />
        <Fact value={weekdayLong(plan.inputs.longRunDay)} label="Long run" />
      </View>
    </View>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="labelStrong" style={{ fontSize: 14 }}>
        {value}
      </T>
      <T v="micro" tone="secondary" style={{ fontWeight: '400' }} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

const ScheduleDay = memo(function ScheduleDay({ weekday, run, entries, routines, onEdit }: { weekday: Weekday; run: string | undefined; entries: ScheduleEntry[]; routines: readonly Routine[]; onEdit: (entryId?: string) => void }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${weekdayLong(weekday)}`} onPress={() => {
        haptic.tap();
        onEdit();
      }} style={({ pressed }) => [s.day, pressed && { opacity: 0.7 }]}>
      {/* One line at any font scale: the column grows instead of wrapping "Mon". */}
      <T v="labelStrong" numberOfLines={1} style={{ minWidth: 36, paddingTop: 5 }}>
        {weekdayShort(weekday)}
      </T>
      <View style={s.chips}>
        {run && <Chip c={p.run} label={run} />}
        {entries.map((e) => {
          const r = routines.find((x) => x.id === e.routineId);
          if (!r) return null;
          return <Chip key={e.id} c={r.kind === 'strength' ? p.strength : p.stretch} label={chipLabel(e, r)} onPress={() => onEdit(e.id)} />;
        })}
        <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${weekdayLong(weekday)}`} onPress={() => {
          haptic.tap();
          onEdit();
        }} hitSlop={8} style={s.add}>
          <Icons.plus size={14} color={p.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  );
});

function Chip({ c, label, onPress }: { c: ActivityColor; label: string; onPress?: () => void }) {
  const s = useStyles();
  const body = (
    <View style={[s.chip, { backgroundColor: c.tint }]}>
      <T v="captionMedium" color={c.onTint}>
        {label}
      </T>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={() => {
      haptic.tap();
      onPress();
    }} hitSlop={4}>
      {body}
    </Pressable>
  );
}

/** One sheet for a weekday: its routines (tap to edit time and reminder) and what can be added. */
function DayEditor({ editing, onChange }: { editing: { weekday: Weekday; entryId?: string } | undefined; onChange: (e: { weekday: Weekday; entryId?: string } | undefined) => void }) {
  const schedule = useSchedule();
  const routines = useRoutines();
  const close = () => onChange(undefined);
  if (!editing) return <Sheet visible={false} onClose={close} />;
  const entry = editing.entryId ? schedule.find((e) => e.id === editing.entryId) : undefined;
  const routine = entry ? routines.find((r) => r.id === entry.routineId) : undefined;
  if (entry && routine) {
    return (
      <Sheet visible onClose={close} title={`${routine.name}, ${weekdayLong(entry.weekday)}`} scroll>
        <EntryEditor entry={entry} routine={routine} onDone={() => onChange({ weekday: editing.weekday })} />
      </Sheet>
    );
  }
  const entries = sortEntries(schedule.filter((e) => e.weekday === editing.weekday), routines);
  const available = routines.filter((r) => !entries.some((e) => e.routineId === r.id));
  return (
    <Sheet visible onClose={close} title={weekdayLong(editing.weekday)} scroll>
      <View style={{ gap: 6 }}>
        {entries.length === 0 && (
          <T v="label" tone="secondary" style={{ fontWeight: '400' }}>
            No workouts or stretches on this day.
          </T>
        )}
        {entries.map((e) => {
          const r = routines.find((x) => x.id === e.routineId);
          if (!r) return null;
          return <RoutineRow key={e.id} routine={r} meta={e.time ? `${clockTime(e.time)}${e.reminder ? ', reminder on' : ''}` : 'No set time'} action="edit" onPress={() => onChange({ weekday: editing.weekday, entryId: e.id })} />;
        })}
      </View>
      {available.length > 0 && (
        <View style={{ gap: 6 }}>
          <T v="captionStrong" tone="secondary">
            Add
          </T>
          {available.map((r) => (
            <RoutineRow
              key={r.id}
              routine={r}
              meta={r.kind === 'strength' ? `${r.itemCount} exercises` : `${r.itemCount} moves`}
              action="add"
              onPress={() => {
                haptic.commit();
                const slot: ScheduleSlot = r.kind === 'stretch' ? (r.name.startsWith('Evening') ? 'evening' : 'morning') : 'any';
                actions.addScheduleEntry({ weekday: editing.weekday, routineId: r.id, slot, time: r.kind === 'stretch' ? DEFAULT_TIME[slot] : undefined, reminder: r.kind === 'stretch' });
              }}
            />
          ))}
        </View>
      )}
    </Sheet>
  );
}

function RoutineRow({ routine, meta, action, onPress }: { routine: Routine; meta: string; action: 'add' | 'edit'; onPress: () => void }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${action === 'add' ? 'Add' : 'Edit'} ${routine.name}`} onPress={() => {
      haptic.tap();
      onPress();
    }} style={({ pressed }) => [s.routineRow, pressed && { opacity: 0.7 }]}>
      <LaneTile lane={routine.kind === 'strength' ? 'workout' : 'stretch'} />
      <View style={{ flex: 1 }}>
        <T v="bodyMedium">{routine.name}</T>
        <T v="caption" tone="secondary">
          {meta}
        </T>
      </View>
      {action === 'add' ? <Icons.plus size={20} color={p.text} /> : <Icons.chevronRight size={20} color={p.textTertiary} />}
    </Pressable>
  );
}

function EntryEditor({ entry, routine, onDone }: { entry: ScheduleEntry; routine: Routine; onDone: () => void }) {
  const p = usePalette();
  const slot = entry.slot ?? 'any';
  const update = (patch: Partial<Omit<ScheduleEntry, 'id'>>) => actions.updateScheduleEntry(entry.id, patch);
  const shift = (delta: number) => update({ time: hhmm(minutesOf(entry.time ?? DEFAULT_TIME[slot]) + delta) });
  return (
    <>
      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Part of the day
        </T>
        <Segmented
          look="inset"
          options={[
            { value: 'morning', label: 'Morning' },
            { value: 'any', label: 'Any time' },
            { value: 'evening', label: 'Evening' },
          ]}
          value={slot}
          onChange={(v) => update({ slot: v, time: entry.time ? DEFAULT_TIME[v] : undefined })}
        />
      </View>
      <Group style={{ borderWidth: 1, borderColor: p.outline }}>
        <Row label="Time">
          {entry.time ? (
            <Stepper value={clockTime(entry.time)} minusLabel="15 minutes earlier" plusLabel="15 minutes later" onMinus={() => shift(-15)} onPlus={() => shift(15)} width={84} />
          ) : (
            <Button label="Set a time" kind="quiet" size="sm" onPress={() => update({ time: DEFAULT_TIME[slot] })} />
          )}
        </Row>
        {entry.time && (
          <Row label="No set time">
            <Button label="Clear" kind="quiet" size="sm" onPress={() => update({ time: undefined, reminder: false })} />
          </Row>
        )}
        <Row label="Reminder" sub={entry.time ? `At ${clockTime(entry.time)}` : 'Needs a time'} last>
          <Switch
            value={entry.reminder && !!entry.time}
            disabled={!entry.time}
            onValueChange={(reminder) => {
              haptic.tick();
              update({ reminder });
            }}
            trackColor={{ true: p.primary, false: p.border }}
            thumbColor={p.surface}
            accessibilityLabel="Reminder"
          />
        </Row>
      </Group>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Remove"
          kind="outline"
          style={{ flex: 1 }}
          onPress={() => {
            haptic.commit();
            const { id: _id, position: _pos, ...rest } = entry;
            actions.removeScheduleEntry(entry.id);
            onDone();
            showSnack({ message: `${routine.name} removed from ${weekdayLong(entry.weekday)}s`, actionLabel: 'Undo', onAction: () => actions.addScheduleEntry(rest) });
          }}
        />
        <Button label="Done" style={{ flex: 1 }} onPress={onDone} />
      </View>
    </>
  );
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 16, padding: 14, gap: 12 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  day: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.surface, minHeight: 48 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center' },
  add: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: p.dashed, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', gap: 14 },
  routineRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: p.bg, minHeight: 60 },
}));
