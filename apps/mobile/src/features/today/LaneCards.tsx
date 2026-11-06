/**
 * Under the Orbit ring (spec §14): one card per lane today in a row, and in place of the
 * row while a lane is focused, that lane's detail card with Complete and Skip.
 */
import { type AgendaItem, type Lane, type RingArc, type UnitPrefs, formatMinutes } from '@fit/core';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { repo } from '@/data';
import { openItemSheet } from '@/features/items/ItemSheet';
import { useItemViews } from '@/features/library/RoutineScreen';
import { clockTime } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { createStyles } from '@/theme';
import { Button, GradientTile, StructureBar, T } from '@/ui/primitives';
import { LANE_NAME, laneStatus } from './lanes';

export function LaneCards({ arcs, items, units, onFocus }: { arcs: readonly RingArc[]; items: readonly AgendaItem[]; units: UnitPrefs; onFocus: (lane: Lane) => void }) {
  const s = useStyles();
  return (
    <View style={s.row}>
      {arcs.map((a) => {
        const own = items.filter((i) => i.lane === a.lane);
        const status = laneStatus(own, units);
        return (
          <Pressable
            key={a.lane}
            accessibilityRole="button"
            accessibilityLabel={`${LANE_NAME[a.lane]}, ${a.done === a.total ? 'done' : status}`}
            accessibilityHint="Shows this lane"
            onPress={() => {
              haptic.tick();
              onFocus(a.lane);
            }}
            style={({ pressed }) => [s.card, pressed && { opacity: 0.7 }]}
          >
            <GradientTile lane={a.lane} done={a.done === a.total} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T v="labelStrong" numberOfLines={1}>
                {LANE_NAME[a.lane]}
              </T>
              <T v="caption" tone="secondary" num numberOfLines={1}>
                {status}
              </T>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** How many routine rows the detail card lists before "2 more exercises". */
const SHOWN = 3;

/** A focused lane: its next item (or its first, once all are done), what it holds, and Complete and Skip. */
export function LaneDetail({ lane, items }: { lane: Lane; items: readonly AgendaItem[] }) {
  const s = useStyles();
  const item = items.find((i) => i.status === 'pending') ?? items[0];
  if (!item) return null;
  const when = [item.time ? clockTime(item.time) : undefined, `about ${formatMinutes(item.estSeconds)}`].filter(Boolean).join(', ');
  const pending = item.status === 'pending';
  return (
    <View style={s.detail}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens actions" onPress={() => openItemSheet(item.key)} style={s.detailHead}>
        <GradientTile lane={lane} size={40} done={item.status === 'done'} />
        <View style={{ flex: 1 }}>
          <T v="headline">{item.title}</T>
          <T v="label" tone="secondary" num>
            {pending ? when : item.status === 'done' ? 'Done' : 'Skipped'}
          </T>
        </View>
      </Pressable>
      {item.source.type === 'schedule' ? <RoutineLines id={item.refId} lane={lane} /> : item.structure && item.structure.length > 0 ? <StructureBar segments={item.structure} height={10} /> : null}
      {pending && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label="Complete"
            kind="outline"
            size="md"
            style={{ flex: 1 }}
            onPress={() => {
              haptic.tap();
              openItemSheet(item.key, 'details');
            }}
          />
          <Button label="Skip" kind="outline" size="md" style={{ flex: 1 }} onPress={() => openItemSheet(item.key, 'skip')} />
        </View>
      )}
    </View>
  );
}

/** The first exercises or moves with their sets, reps and weight, or holds. */
function RoutineLines({ id, lane }: { id: string; lane: Lane }) {
  const routine = useMemo(() => repo.routine(id), [id]);
  const rows = useItemViews(routine);
  if (rows.length === 0) return null;
  const more = rows.length - SHOWN;
  const noun = lane === 'stretch' ? (more === 1 ? 'move' : 'moves') : more === 1 ? 'exercise' : 'exercises';
  return (
    <View style={{ gap: 8 }}>
      {rows.slice(0, SHOWN).map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <T v="body" numberOfLines={1} style={{ flexShrink: 1 }}>
            {r.name}
          </T>
          {/* The rest is in the routine; the card keeps sets, reps and weight. */}
          <T v="body" tone="secondary" num numberOfLines={1}>
            {r.line.replace(/, rest \d+ s$/, '')}
          </T>
        </View>
      ))}
      {more > 0 && (
        <T v="label" tone="secondary">
          {`${more} more ${noun}`}
        </T>
      )}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  row: { flexDirection: 'row', gap: 8 },
  card: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 56, padding: 10, borderRadius: 16, backgroundColor: p.surface },
  detail: { backgroundColor: p.surface, borderRadius: 20, padding: 16, gap: 12 },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
