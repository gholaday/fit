/**
 * A saved watch activity (spec §5, §11): what Health Connect gave us, and its route. Health
 * Connect does not share routes, so a GPX export from Garmin Connect can be added here; it
 * draws on the same map as recorded runs.
 */
import { type ExternalSession, type SessionDetail, formatDistance, formatMinutes } from '@fit/core';
import { router, useLocalSearchParams } from 'expo-router';
import { lazy, Suspense, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { showSnack, useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, IconButton, T } from '@/ui/primitives';
import { StatusShade } from '@/ui/StatusShade';
import { ACTIVITY_ICON, ACTIVITY_LABEL, whenLabel } from './ActivityModal';

const RouteMap = lazy(() => import('@/features/run/RouteMap'));

/** The map reads a session; a watch route is one with no steps, pauses or replay. */
function asSession(ext: ExternalSession, points: SessionDetail['points']): SessionDetail {
  const ms = Date.parse(ext.endedAt) - Date.parse(ext.startedAt);
  return { id: ext.id, name: ext.title, mode: 'outdoor', startedAt: ext.startedAt, endedAt: ext.endedAt, distanceM: ext.distanceM ?? 0, elapsedMs: ms, pausedMs: 0, steps: [], log: [], pauses: [], points, hr: [], hrFromHealth: false };
}

export function ExternalActivityScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;
  const [ext] = useState(() => repo.externalSession(id));
  const [points, setPoints] = useState(() => repo.externalRoute(id));
  const [busy, setBusy] = useState(false);

  if (!ext) {
    return (
      <View style={[s.screen, s.center]}>
        <T v="bodyMedium" tone="secondary">
          Activity not found
        </T>
        <Button label="Back" kind="outline" size="sm" onPress={() => router.back()} />
      </View>
    );
  }

  const Icon = ACTIVITY_ICON[ext.activity];
  const seconds = (Date.parse(ext.endedAt) - Date.parse(ext.startedAt)) / 1000;
  const facts: { value: string; label: string }[] = [
    { value: formatMinutes(seconds), label: 'Time' },
    ...(ext.distanceM ? [{ value: formatDistance(ext.distanceM, unit, 2), label: 'Distance' }] : []),
    ...(ext.avgHr ? [{ value: `${Math.round(ext.avgHr)} bpm`, label: 'Average HR' }] : []),
    ...(ext.maxHr ? [{ value: `${Math.round(ext.maxHr)} bpm`, label: 'Max HR' }] : []),
    ...(ext.activeKcal ? [{ value: `${Math.round(ext.activeKcal)} kcal`, label: 'Active calories' }] : []),
  ];

  const addRoute = async () => {
    haptic.tap();
    setBusy(true);
    try {
      // Loaded on demand: the file modules are native and only exist in newer builds.
      const { pickGpx } = await import('@/features/run/gpx');
      const gpx = await pickGpx();
      if (!gpx) return;
      repo.attachExternalRoute(ext.id, gpx.points);
      setPoints(repo.externalRoute(ext.id));
      haptic.commit();
      showSnack({ message: `Route added, ${gpx.points.length} points` });
    } catch {
      showSnack({ message: 'Could not read a route from that file' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Back" size={40} onPress={() => router.back()}>
            <Icons.chevronLeft size={20} color={p.text} />
          </IconButton>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <T v="headline">{ext.title}</T>
            <T v="caption" tone="secondary">
              {`${ACTIVITY_LABEL[ext.activity]}, ${whenLabel(ext.startedAt)}`}
            </T>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {points.length > 1 ? (
          <Suspense fallback={<View style={s.mapSlot} />}>
            <RouteMap session={asSession(ext, points)} replay={false} />
          </Suspense>
        ) : (
          <View style={[s.mapSlot, s.center, { paddingHorizontal: 24 }]}>
            <View style={s.badge}>
              <Icon size={22} color={p.run.onTint} />
            </View>
            <T v="bodyMedium" align="center">
              No route from Health Connect
            </T>
            <T v="caption" tone="secondary" align="center">
              Export the activity as GPX from Garmin Connect, then add the file here.
            </T>
          </View>
        )}

        <View style={s.facts}>
          {facts.map((f) => (
            <View key={f.label} style={s.fact}>
              <T v="title" num>
                {f.value}
              </T>
              <T v="caption" tone="secondary">
                {f.label}
              </T>
            </View>
          ))}
        </View>

        <Button label={points.length > 1 ? 'Replace route from file' : 'Add route from file'} kind={points.length > 1 ? 'quiet' : 'primary'} size="md" disabled={busy} onPress={() => void addRoute()} />
      </ScrollView>
      <StatusShade />
    </View>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  content: { paddingHorizontal: 20, gap: 16 },
  top: { flexDirection: 'row', alignItems: 'center' },
  mapSlot: { height: 240, borderRadius: 20, backgroundColor: p.surface },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: p.run.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, paddingHorizontal: 4 },
  fact: { width: '50%' },
}));
