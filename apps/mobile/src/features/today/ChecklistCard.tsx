import { type AgendaItem, formatDistance, formatMinutes } from '@fit/core';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { useItem, usePlan, useRoutines, useUnits } from '@/data/store';
import { markDoneNow, openItemSheet } from '@/features/items/ItemSheet';
import { itemSubtitle } from '@/features/items/meta';
import { clockTime } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, LaneTile, StructureBar, T } from '@/ui/primitives';

/**
 * One checklist card. Done is one tap; long-press Done opens Done + details; the card
 * body opens the actions sheet (Skip, Move to tomorrow, Move to another day).
 */
export const ChecklistCard = memo(function ChecklistCard({ itemKey, hero }: { itemKey: string; hero: boolean }) {
  const item = useItem(itemKey);
  if (!item) return null;
  if (item.status !== 'pending') return <ResolvedRow item={item} />;
  if (hero) return <HeroRunCard item={item} />;
  return <CompactCard item={item} />;
});

function HeroRunCard({ item }: { item: AgendaItem }) {
  const s = useStyles();
  const p = usePalette();
  const units = useUnits();
  const plan = usePlan();
  const week = item.source.type === 'plan_workout' ? item.source.weekIndex + 1 : undefined;
  const eyebrow = plan && week ? `${plan.name}, week ${week}` : 'Run';
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens actions" onPress={() => openItemSheet(item.key)} style={s.hero}>
      <View style={s.heroHead}>
        <LaneTile lane="run" size={40} />
        <View style={{ flex: 1 }}>
          <T v="captionMedium" tone="secondary">
            {eyebrow}
          </T>
          <T v="title">{item.title}</T>
        </View>
      </View>
      <View style={s.stats}>
        <Stat value={formatMinutes(item.estSeconds)} label="Duration" />
        {item.hrRange ? <Stat value={`${item.hrRange.minBpm}-${item.hrRange.maxBpm}`} label="Target bpm" /> : <Stat value={item.hard ? 'Hard' : 'Easy'} label="Effort" />}
        {item.estMeters ? <Stat value={formatDistance(item.estMeters, units.distance)} label="Estimated" /> : <View style={{ flex: 1 }} />}
      </View>
      {item.structure && item.structure.length > 0 && <StructureBar segments={item.structure} />}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="Done"
          size="md"
          style={{ flex: 1 }}
          accessibilityHint="Hold for details"
          onPress={() => markDoneNow(item)}
          onLongPress={() => openItemSheet(item.key, 'details')}
          delayLongPress={350}
          icon={<Icons.check size={18} color={p.onPrimary} />}
        />
        <Button label="More" size="md" kind="outline" style={{ width: 96 }} onPress={() => openItemSheet(item.key)} />
      </View>
    </Pressable>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="stat" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      <T v="caption" tone="secondary">
        {label}
      </T>
    </View>
  );
}

function CompactCard({ item }: { item: AgendaItem }) {
  const s = useStyles();
  const p = usePalette();
  const routines = useRoutines();
  const units = useUnits();
  const later = item.slot === 'evening';
  const sub = itemSubtitle(item, routines, units);
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens actions" onPress={() => openItemSheet(item.key)} style={[s.compact, later && s.later]}>
      <LaneTile lane={item.lane} />
      <View style={{ flex: 1 }}>
        <T v={later ? 'bodyMedium' : 'bodyStrong'}>{item.title}</T>
        <T v="caption" tone="secondary">
          {item.time ? `${clockTime(item.time)}, ${sub}` : sub}
        </T>
      </View>
      <IconButton label={`Done, ${item.title}`} bg="none" size={40} onPress={() => markDoneNow(item)} onLongPress={() => openItemSheet(item.key, 'details')} delayLongPress={350} style={{ borderWidth: 1, borderColor: p.border, borderRadius: 12 }}>
        <Icons.check size={18} color={p.text} />
      </IconButton>
    </Pressable>
  );
}

function ResolvedRow({ item }: { item: AgendaItem }) {
  const s = useStyles();
  const p = usePalette();
  const routines = useRoutines();
  const units = useUnits();
  const done = item.status === 'done';
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens actions" onPress={() => openItemSheet(item.key)} style={s.resolved}>
      <LaneTile lane={item.lane} faded />
      <View style={{ flex: 1 }}>
        <T v="bodyMedium" tone="secondary">
          {item.title}
        </T>
        <T v="caption" tone="tertiary">
          {itemSubtitle(item, routines, units)}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {done && <Icons.check size={14} color={p.success} />}
        <T v="captionMedium" color={done ? p.success : p.textTertiary}>
          {done ? 'Done' : 'Skipped'}
        </T>
      </View>
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  hero: { backgroundColor: p.surface, borderRadius: 20, padding: 16, gap: 14 },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stats: { flexDirection: 'row', gap: 8 },
  compact: { backgroundColor: p.surface, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  later: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.outline },
  resolved: { backgroundColor: p.doneRow, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
}));
