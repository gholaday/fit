/**
 * New-activity modal (spec §11): a watch workout read from Health Connect, one at a time
 * ("1 of 2"). Link it to a plan item (the strong match is pre-selected) or save it as not
 * part of the plan; Ignore drops it; Later closes the modal and Today keeps a chip.
 */
import { type AgendaItem, type ExternalActivity, type ExternalSession, formatDistance, formatMinutes, localIsoDate } from '@fit/core';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { repo } from '@/data';
import { actions, showSnack, useUnits } from '@/data/store';
import { useFormStyles } from '@/features/items/ItemSheet';
import { shortDate } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, usePalette } from '@/theme';
import { Icons, LANE_ICON, QUICK_LOG_ICON } from '@/ui/icons';
import { Button, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { closeActivities, markHandled, reloadHealth, useHealth } from './state';

export const ACTIVITY_LABEL: Record<ExternalActivity, string> = {
  run: 'Run',
  treadmill: 'Treadmill run',
  walk: 'Walk',
  hike: 'Hike',
  bike: 'Bike',
  swim: 'Swim',
  strength: 'Strength',
  stretch: 'Stretch',
  other: 'Activity',
};

export const ACTIVITY_ICON = {
  run: QUICK_LOG_ICON.run,
  treadmill: QUICK_LOG_ICON.run,
  walk: QUICK_LOG_ICON.walk,
  hike: QUICK_LOG_ICON.hike,
  bike: QUICK_LOG_ICON.bike,
  swim: QUICK_LOG_ICON.swim,
  strength: QUICK_LOG_ICON.lift,
  stretch: QUICK_LOG_ICON.stretch,
  other: QUICK_LOG_ICON.other,
} as const;

/** "Today, 6:12 PM" or "Oct 25, 6:12 PM". */
function whenLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  const date = localIsoDate(d);
  return `${date === localIsoDate(new Date()) ? 'Today' : shortDate(date)}, ${time}`;
}

const NONE = 'none';

export function ActivityModalHost() {
  const open = useHealth((h) => h.modalOpen);
  const pending = useHealth((h) => h.pending);
  const handled = useHealth((h) => h.handled);
  const current = pending[0];
  return (
    <Sheet visible={open && current !== undefined} onClose={closeActivities} title="New activity" scroll>
      {current && <Form key={current.id} ext={current} position={handled + 1} total={handled + pending.length} />}
    </Sheet>
  );
}

function Form({ ext, position, total }: { ext: ExternalSession; position: number; total: number }) {
  const p = usePalette();
  const s = useStyles();
  const f = useFormStyles();
  const units = useUnits();
  const [match] = useState(() => repo.planMatch(ext.id));
  const [choice, setChoice] = useState<string>(match.suggested?.key ?? NONE);
  const [title, setTitle] = useState(ext.title);
  const [rpe, setRpe] = useState<number>();
  const Icon = ACTIVITY_ICON[ext.activity];
  const seconds = (Date.parse(ext.endedAt) - Date.parse(ext.startedAt)) / 1000;
  const facts = [formatMinutes(seconds), ext.distanceM ? formatDistance(ext.distanceM, units.distance, 2) : undefined, ext.avgHr ? `${Math.round(ext.avgHr)} bpm avg` : undefined].filter(Boolean).join(', ');

  const after = (message: string) => {
    markHandled();
    reloadHealth();
    actions.reload();
    showSnack({ message });
  };

  const save = () => {
    haptic.commit();
    const planKey = choice === NONE ? undefined : choice;
    repo.saveExternal(ext.id, { planKey, title: title.trim() || ext.title, activity: ext.activity, rpe });
    after(planKey ? 'Saved to your plan' : 'Saved, not part of your plan');
  };

  const ignore = () => {
    haptic.tap();
    repo.ignoreExternal(ext.id);
    after('Activity ignored');
  };

  return (
    <>
      {total > 1 && (
        <T v="captionStrong" tone="secondary">
          {`${position} of ${total}`}
        </T>
      )}
      <View style={s.head}>
        <View style={s.tile}>
          <Icon size={22} color={p.text} />
        </View>
        <View style={{ flex: 1 }}>
          <T v="bodyStrong" numberOfLines={1}>
            {`${ACTIVITY_LABEL[ext.activity]}, ${whenLabel(ext.startedAt)}`}
          </T>
          <T v="caption" tone="secondary" num>
            {facts}
          </T>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Title
        </T>
        <TextInput value={title} onChangeText={setTitle} style={f.input} placeholderTextColor={p.textTertiary} accessibilityLabel="Title" />
      </View>

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          Part of your plan
        </T>
        <View style={s.options}>
          {match.candidates.map((c) => (
            <Option key={c.key} on={choice === c.key} onPress={() => setChoice(c.key)} item={c} suggested={c.key === match.suggested?.key} />
          ))}
          <Option on={choice === NONE} onPress={() => setChoice(NONE)} label="Not part of my plan" />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <T v="labelStrong" tone="secondary">
          How hard was it
        </T>
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`Effort ${n} of 10`}
              accessibilityState={{ selected: rpe === n }}
              onPress={() => {
                haptic.tick();
                setRpe(rpe === n ? undefined : n);
              }}
              style={[f.rpe, rpe === n && { backgroundColor: p.primary }]}
            >
              <T v="label" num color={rpe === n ? p.onPrimary : p.text}>
                {String(n)}
              </T>
            </Pressable>
          ))}
        </View>
      </View>

      <Button label="Save" onPress={save} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button label="Ignore" kind="quiet" size="md" style={{ flex: 1 }} onPress={ignore} />
        <Button
          label="Later"
          kind="quiet"
          size="md"
          style={{ flex: 1 }}
          onPress={() => {
            haptic.tap();
            closeActivities();
          }}
        />
      </View>
    </>
  );
}

function Option({ on, onPress, item, suggested, label }: { on: boolean; onPress: () => void; item?: AgendaItem; suggested?: boolean; label?: string }) {
  const p = usePalette();
  const s = useStyles();
  const LaneIcon = item ? LANE_ICON[item.lane] : undefined;
  const text = item ? (suggested && item.status === 'done' ? `Attach to the completed ${item.title}` : item.title) : label!;
  const sub = item ? `${shortDate(item.date)}${item.estSeconds > 0 ? `, ${formatMinutes(item.estSeconds)} planned` : ''}${suggested ? ', best match' : ''}` : undefined;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      onPress={() => {
        haptic.tick();
        onPress();
      }}
      style={[s.option, on && { borderColor: p.primary, backgroundColor: p.surface }]}
    >
      {LaneIcon ? <LaneIcon size={18} color={laneColor(p, item!.lane).color} /> : <Icons.x size={18} color={p.textTertiary} />}
      <View style={{ flex: 1 }}>
        <T v="bodyMedium" numberOfLines={2}>
          {text}
        </T>
        {sub && (
          <T v="caption" tone="secondary">
            {sub}
          </T>
        )}
      </View>
      <View style={[s.radio, on && { borderColor: p.primary }]}>{on && <View style={s.radioDot} />}</View>
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tile: { width: 44, height: 44, borderRadius: 12, backgroundColor: p.inset, alignItems: 'center', justifyContent: 'center' },
  options: { gap: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: p.inset },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: p.primary },
}));
