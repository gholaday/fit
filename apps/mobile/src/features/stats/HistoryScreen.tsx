/**
 * History (spec §12): every session newest first, Fit and watch, with filters by kind,
 * mode and source, a name search, and paging as you scroll. Runs open their summary,
 * watch sessions their activity screen.
 */
import { GARMIN_CONNECT_PACKAGE, type HistoryFilter, type HistoryItem, type HistoryKind, type Lane, type SessionMode, formatDistance, formatMinutes } from '@fit/core';
import { router } from 'expo-router';
import { memo, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { useUnits } from '@/data/store';
import { useFocusedDataVersion } from '@/lib/focusedVersion';
import { haptic } from '@/lib/haptics';
import { activityColor, createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Chip, IconButton, LaneTile, T } from '@/ui/primitives';

const PAGE = 30;

const KINDS: readonly { value: HistoryKind; label: string }[] = [
  { value: 'run', label: 'Runs' },
  { value: 'walk', label: 'Walks' },
  { value: 'strength', label: 'Strength' },
  { value: 'stretch', label: 'Stretch' },
  { value: 'other', label: 'Other' },
];
const MODES: readonly { value: SessionMode; label: string }[] = [
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'treadmill', label: 'Treadmill' },
  { value: 'timer', label: 'Timer' },
];
const SOURCES: readonly { value: 'fit' | 'external'; label: string }[] = [
  { value: 'fit', label: 'Recorded in Fit' },
  { value: 'external', label: 'From watch' },
];

const LANE: Partial<Record<HistoryKind, Lane>> = { run: 'run', strength: 'workout', stretch: 'stretch' };

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Tue, Oct 27, 6:10 PM" */
function startedLabel(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${DOW[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

export function HistoryScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  // Under a summary or replay, writes wait until History is shown again.
  const version = useFocusedDataVersion();
  const [kind, setKind] = useState<HistoryKind>();
  const [mode, setMode] = useState<SessionMode>();
  const [source, setSource] = useState<'fit' | 'external'>();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [more, setMore] = useState(true);

  const filter = (limit: number, before?: string): HistoryFilter => {
    const f: HistoryFilter = { limit };
    if (kind) f.kind = kind;
    if (mode) f.mode = mode;
    if (source) f.source = source;
    if (search.trim()) f.search = search.trim();
    if (before) f.before = before;
    return f;
  };

  // A filter or the search starts over at the first page. A data change re-reads the rows
  // already loaded, keeping unchanged ones so they do not re-render and the list keeps its length.
  const filterKey = `${kind}|${mode}|${source}|${search}`;
  const shownKey = useRef(filterKey);
  useEffect(() => {
    const same = shownKey.current === filterKey;
    shownKey.current = filterKey;
    const limit = same ? Math.max(PAGE, items.length) : PAGE;
    const page = repo.history(filter(limit));
    setItems(same ? keepRows(items, page) : page);
    setMore(page.length === limit);
  }, [filterKey, version]);

  const loadMore = () => {
    if (!more || items.length === 0) return;
    const page = repo.history(filter(PAGE, items[items.length - 1]!.startedAt));
    setItems([...items, ...page]);
    setMore(page.length === PAGE);
  };

  const toggle = <V,>(value: V, current: V | undefined, set: (v: V | undefined) => void) => {
    haptic.tick();
    set(current === value ? undefined : value);
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + 8 }]}>
      <View style={s.top}>
        <IconButton label="Back" size={40} onPress={() => router.back()}>
          <Icons.chevronLeft size={20} color={p.text} />
        </IconButton>
        <T v="heading" accessibilityRole="header">
          History
        </T>
      </View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Search by name" placeholderTextColor={p.textTertiary} accessibilityLabel="Search by name" style={s.search} returnKeyType="search" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
        {KINDS.map((k) => (
          <Chip key={k.value} label={k.label} on={kind === k.value} onPress={() => toggle(k.value, kind, setKind)} />
        ))}
        <View style={s.sep} />
        {MODES.map((m) => (
          <Chip key={m.value} label={m.label} on={mode === m.value} onPress={() => toggle(m.value, mode, setMode)} />
        ))}
        <View style={s.sep} />
        {SOURCES.map((o) => (
          <Chip key={o.value} label={o.label} on={source === o.value} onPress={() => toggle(o.value, source, setSource)} />
        ))}
      </ScrollView>
      <FlatList
        data={items}
        keyExtractor={rowKey}
        renderItem={({ item }) => <HistoryRow item={item} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 8 }}
        ListEmptyComponent={
          <T v="body" tone="secondary" align="center" style={{ paddingTop: 40 }}>
            {kind || mode || source || search.trim() ? 'Nothing matches these filters.' : 'Sessions you record or import show here.'}
          </T>
        }
      />
    </View>
  );
}

const rowKey = (i: HistoryItem) => `${i.source}:${i.id}`;

/** `next`, reusing the row objects from `prev` that did not change. */
function keepRows(prev: readonly HistoryItem[], next: HistoryItem[]): HistoryItem[] {
  const old = new Map(prev.map((i) => [rowKey(i), i]));
  return next.map((i) => {
    const o = old.get(rowKey(i));
    return o && JSON.stringify(o) === JSON.stringify(i) ? o : i;
  });
}

const HistoryRow = memo(function HistoryRow({ item }: { item: HistoryItem }) {
  const s = useStyles();
  const p = usePalette();
  const unit = useUnits().distance;
  const lane = LANE[item.kind];
  const open =
    item.source === 'external'
      ? () => router.push({ pathname: '/activity/[id]', params: { id: item.id } })
      : item.kind === 'run'
        ? () => router.push({ pathname: '/summary/[id]', params: { id: item.id } })
        : item.kind === 'strength'
          ? () => router.push({ pathname: '/lift/[id]', params: { id: item.id } })
          : undefined;
  const meta = [startedLabel(item.startedAt), item.distanceM ? formatDistance(item.distanceM, unit, 2) : undefined, item.durationS > 0 ? formatMinutes(item.durationS) : undefined].filter(Boolean).join(', ');
  const Icon = item.kind === 'walk' ? Icons.walk : Icons.dots;
  return (
    <Pressable accessibilityRole={open ? 'button' : undefined} disabled={!open} onPress={open} style={s.row}>
      {lane ? (
        <LaneTile lane={lane} size={36} />
      ) : (
        <View style={[s.tile, { backgroundColor: activityColor(p, item.kind).tint }]}>
          <Icon size={20} color={activityColor(p, item.kind).color} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T v="bodyMedium" numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.name}
          </T>
          {item.originPackage === GARMIN_CONNECT_PACKAGE && (
            <View style={s.badge}>
              <T v="tiny" tone="secondary">
                Garmin
              </T>
            </View>
          )}
          {item.mode === 'treadmill' && (
            <View style={s.badge}>
              <T v="tiny" tone="secondary">
                Treadmill
              </T>
            </View>
          )}
        </View>
        <T v="caption" tone="secondary" num numberOfLines={1}>
          {meta}
        </T>
      </View>
      {open && <Icons.chevronRight size={16} color={p.textTertiary} />}
    </Pressable>
  );
});

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 },
  search: { marginHorizontal: 20, height: 44, borderRadius: 12, backgroundColor: p.surface, paddingHorizontal: 14, color: p.text, fontSize: 15 },
  chips: { paddingHorizontal: 20, gap: 8, alignItems: 'center' },
  sep: { width: 1, height: 20, backgroundColor: p.border, marginHorizontal: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.surface, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 },
  tile: { width: 36, height: 36, borderRadius: 10, backgroundColor: p.inset, alignItems: 'center', justifyContent: 'center' },
  badge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: p.inset },
}));
