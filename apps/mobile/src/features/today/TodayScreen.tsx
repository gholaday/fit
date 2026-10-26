import { addDays } from '@fit/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useDayKeys, useFit, useSettings, useToday } from '@/data/store';
import { openActivities, syncedLabel, useHealth } from '@/features/health/state';
import { syncHealth } from '@/features/health/sync';
import { QuickLogSheet } from '@/features/quicklog/QuickLogSheet';
import { haptic } from '@/lib/haptics';
import { longDate } from '@/lib/format';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import { ChecklistCard } from './ChecklistCard';
import { DayWidget, SlimBar } from './DayWidget';
import { summarizeDay } from './daySummary';
import { WeekStrip } from './WeekStrip';

/** Scroll distance after which the widget has collapsed into the slim bar. */
const COLLAPSE_FROM = 150;
const COLLAPSE_TO = 200;

export function TodayScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const settings = useSettings();
  const keys = useDayKeys(today);
  const items = useFit(useShallow((st) => keys.map((k) => st.items[k]!)));
  const tomorrowItems = useFit(useShallow((st) => (st.byDate[addDays(today, 1)] ?? []).map((k) => st.items[k]!)));
  const summary = summarizeDay(items, tomorrowItems, new Date().getHours(), settings.units);
  const heroKey = items.find((i) => i.lane === 'run' && i.status === 'pending')?.key;
  const [quickLog, setQuickLog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void syncHealth().finally(() => setRefreshing(false));
  };
  const metrics = useHealth((h) => h.metrics);
  const lastSyncedAt = useHealth((h) => h.lastSyncedAt);
  const pendingCount = useHealth((h) => h.pending.length);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const slimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [COLLAPSE_FROM, COLLAPSE_TO], [-8, 0], Extrapolation.CLAMP) }],
  }));

  return (
    <View style={s.screen}>
      <Animated.ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} progressViewOffset={insets.top} />} onScroll={onScroll} scrollEventThrottle={16} contentContainerStyle={[s.content, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <T v="label" tone="secondary">
              {longDate(today)}
            </T>
            <T v="display" accessibilityRole="header">
              Today
            </T>
          </View>
          <Button label="Quick log" kind="outline" size="sm" style={{ borderRadius: 18 }} icon={<Icons.plus size={14} color={p.text} />} onPress={() => setQuickLog(true)} />
          <IconButton label="Settings" bg="none" onPress={() => router.push('/settings')}>
            <Icons.settings size={22} color={p.text} />
          </IconButton>
        </View>

        <WeekStrip today={today} />
        <DayWidget summary={summary} stepGoal={settings.stepGoal} steps={metrics?.steps} />
        {(metrics || lastSyncedAt) && (
          <View style={s.health}>
            <Icons.heart size={20} color={p.run.color} weight="fill" />
            <View style={{ flex: 1 }}>
              <T v="bodyMedium" num>
                {metrics?.restingHr ? `Resting heart rate ${Math.round(metrics.restingHr)} bpm` : 'Resting heart rate not synced'}
              </T>
              <T v="caption" tone="secondary" num>
                {lastSyncedAt ? `Last synced ${syncedLabel(lastSyncedAt)}` : 'Not synced yet'}
              </T>
            </View>
          </View>
        )}
        {pendingCount > 0 && (
          <Button
            label={`New activities (${pendingCount})`}
            kind="outline"
            size="sm"
            style={{ alignSelf: 'flex-start', borderRadius: 18 }}
            icon={<Icons.bell size={14} color={p.text} />}
            onPress={() => {
              haptic.tap();
              openActivities();
            }}
          />
        )}

        {items.length === 0 ? (
          <View style={s.empty}>
            <T v="bodyMedium" tone="secondary">
              Nothing planned today
            </T>
            <T v="caption" tone="tertiary" align="center">
              Add routines on the Plan tab under Schedule.
            </T>
          </View>
        ) : (
          items.map((i) => <ChecklistCard key={i.key} itemKey={i.key} hero={i.key === heroKey} />)
        )}

        <Button label="Free run" kind="quiet" size="md" style={{ marginTop: 4 }} icon={<Icons.run size={18} color={p.text} />} onPress={() => router.push('/run')} />

      </Animated.ScrollView>

      <Animated.View pointerEvents="none" style={[s.slimWrap, { paddingTop: insets.top + 4 }, slimStyle]}>
        <View style={s.slim}>
          <SlimBar summary={summary} steps={metrics?.steps} />
        </View>
      </Animated.View>
      {/* Keeps scrolled content from showing under the transparent status bar. */}
      <View pointerEvents="none" style={[s.statusBar, { height: insets.top }]} />

      <QuickLogSheet visible={quickLog} onClose={() => setQuickLog(false)} />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 120, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 4 },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: p.bg },
  slimWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 8, backgroundColor: p.bg },
  slim: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3, borderRadius: 14 },
  empty: { alignItems: 'center', gap: 4, paddingVertical: 32 },
  health: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12 },
}));
