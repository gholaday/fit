/**
 * Full-screen replay (spec §5 "Route map & replay"): a marker traces the run with a growing
 * trail, the camera follows (or shows the whole route), and the scrubber runs over the
 * workout's colored structure bar so you can jump straight to a step. 10x to 120x speeds;
 * pauses are skipped during playback.
 *
 * The clock runs on requestAnimationFrame. The scrubber thumb moves every frame on the UI
 * thread; the map and the readout follow at about 20 fps, which is smooth for a marker on a
 * map and keeps native style updates cheap.
 */
import { type DistanceUnit, formatClock, metersToUnit, paceToUnit, type SessionDetail, stepAtOffset } from '@fit/core';
import { Camera, type CameraRef, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { Feature, Point } from 'geojson';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { repo } from '@/data';
import { useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, type Palette, toneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { IconButton, Segmented, T } from '@/ui/primitives';
import { buildRoute, distanceAt, MAP_STYLE, pausedBefore, type RouteGeometry } from './route';
import { RouteLayers } from './RouteMap';
import { repLabel, stepName, stepTone } from './steps';

const SPEEDS = ['10', '30', '60', '120'] as const;
type Speed = (typeof SPEEDS)[number];
/** Map and readout refresh. */
const FRAME_MS = 50;
/** Camera re-centers this often while following, easing over the same time. */
const FOLLOW_MS = 400;
const PACE_WINDOW_MS = 30_000;

export function ReplayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session] = useState<SessionDetail | undefined>(() => repo.session(id));
  const p = usePalette();
  const s = useStyles();
  if (!session || session.points.length < 2) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <T v="bodyMedium" tone="secondary">
          No route to replay
        </T>
        <IconButton label="Close" size={44} onPress={() => router.back()}>
          <Icons.x size={20} color={p.text} />
        </IconButton>
      </View>
    );
  }
  return <Replay session={session} />;
}

function Replay({ session }: { session: SessionDetail }) {
  const p = usePalette();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const unit = useUnits().distance;
  const route = useMemo(() => buildRoute(session, p, unit), [session, p, unit]);
  const end = session.points[session.points.length - 1]!.tOffsetMs;
  const start = session.points[0]!.tOffsetMs;

  const [t, setT] = useState(start);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>('60');
  const [follow, setFollow] = useState(true);
  const tRef = useRef(start);
  const camera = useRef<CameraRef>(null);
  const thumb = useSharedValue(0);

  const seek = (next: number) => {
    tRef.current = Math.min(end, Math.max(start, next));
    thumb.value = (tRef.current - start) / Math.max(1, end - start);
    setT(tRef.current);
  };

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    if (tRef.current >= end) seek(start);
    let last = Date.now();
    let lastFrame = 0;
    let raf = 0;
    const loop = () => {
      const now = Date.now();
      let next = tRef.current + (now - last) * Number(speed);
      last = now;
      // Long stops collapse: jump over paused time.
      for (const [a, b] of session.pauses) if (next > a && next < b) next = b;
      tRef.current = Math.min(end, next);
      thumb.value = (tRef.current - start) / Math.max(1, end - start);
      if (tRef.current >= end) {
        setT(end);
        setPlaying(false);
        return;
      }
      if (now - lastFrame >= FRAME_MS) {
        lastFrame = now;
        setT(tRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const here = useMemo(() => markerAt(session, t), [session, t]);

  // Camera: follow the marker, or frame the whole route.
  const lastFollow = useRef(0);
  useEffect(() => {
    if (!follow) return;
    const now = Date.now();
    if (now - lastFollow.current < FOLLOW_MS) return;
    lastFollow.current = now;
    void camera.current?.easeTo({ center: here.lngLat, duration: playing ? FOLLOW_MS : 250, easing: 'linear' });
  }, [follow, here, playing]);
  const toggleFollow = () => {
    haptic.tick();
    const next = !follow;
    setFollow(next);
    if (next) void camera.current?.easeTo({ center: here.lngLat, zoom: 15.5, duration: 500 });
    else void camera.current?.fitBounds(route.bounds, { padding: { top: 80, right: 40, bottom: 280, left: 40 }, duration: 500 });
  };

  const upTo = route.drawnDist.length > 0 ? distanceAt(route.drawnDist, t) / Math.max(1, route.drawnDist[route.drawnDist.length - 1]!.distanceM) : 0;

  return (
    <View style={s.screen}>
      <Map mapStyle={p.scheme === 'dark' ? MAP_STYLE.dark : MAP_STYLE.light} style={{ flex: 1 }} logo={false} attributionPosition={{ top: insets.top + 64, right: 8 }} touchPitch={false}>
        <Camera ref={camera} initialViewState={{ center: here.lngLat, zoom: 15.5 }} />
        <RouteLayers route={route} p={p} upTo={upTo} />
        <Marker feature={here.feature} p={p} />
      </Map>

      <View style={[s.top, { top: insets.top + 8 }]}>
        <IconButton label="Close replay" size={44} onPress={() => router.back()}>
          <Icons.x size={20} color={p.text} />
        </IconButton>
        <IconButton label={follow ? 'Show whole route' : 'Follow the marker'} size={44} onPress={toggleFollow}>
          {follow ? <Icons.route size={20} color={p.text} /> : <Icons.location size={20} color={p.text} />}
        </IconButton>
      </View>

      <View style={[s.panel, { paddingBottom: insets.bottom + 16 }]}>
        <Readout session={session} route={route} t={t} unit={unit} />
        <Scrubber session={session} start={start} end={end} thumb={thumb} onSeek={seek} onScrubStart={() => setPlaying(false)} />
        <View style={s.controls}>
          <IconButton
            label={playing ? 'Pause replay' : 'Play replay'}
            size={48}
            bg="inset"
            onPress={() => {
              haptic.commit();
              setPlaying(!playing);
            }}
          >
            {playing ? <Icons.pause size={20} color={p.text} /> : <Icons.play size={20} color={p.text} />}
          </IconButton>
          <View style={{ flex: 1 }}>
            <Segmented look="inset" options={SPEEDS.map((v) => ({ value: v, label: `${v}x` }))} value={speed} onChange={setSpeed} />
          </View>
        </View>
      </View>
    </View>
  );
}

/** The marker position at a time offset, interpolated on the full-resolution track. */
function markerAt(session: SessionDetail, t: number) {
  const pts = session.points;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid]!.tOffsetMs <= t) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!;
  const b = pts[hi]!;
  const f = b.tOffsetMs > a.tOffsetMs ? Math.min(1, Math.max(0, (t - a.tOffsetMs) / (b.tOffsetMs - a.tOffsetMs))) : 0;
  const lngLat: [number, number] = [a.lng + f * (b.lng - a.lng), a.lat + f * (b.lat - a.lat)];
  const feature: Feature<Point> = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat } };
  return { lngLat, feature };
}

const Marker = memo(function Marker({ feature, p }: { feature: Feature<Point>; p: Palette }) {
  return (
    <GeoJSONSource id="me" data={feature}>
      <Layer type="circle" id="me-halo" paint={{ 'circle-radius': 14, 'circle-color': p.run.color, 'circle-opacity': 0.22 }} />
      <Layer type="circle" id="me-dot" paint={{ 'circle-radius': 7, 'circle-color': p.run.color, 'circle-stroke-color': p.surface, 'circle-stroke-width': 2.5 }} />
    </GeoJSONSource>
  );
});

/** Elapsed (active) time, distance, rolling pace and the current step at the marker. */
function Readout({ session, route, t, unit }: { session: SessionDetail; route: RouteGeometry; t: number; unit: DistanceUnit }) {
  const p = usePalette();
  const s = useStyles();
  const d = distanceAt(route.dist, t);
  const from = Math.max(route.dist[0]!.tOffsetMs, t - PACE_WINDOW_MS);
  const windowM = d - distanceAt(route.dist, from);
  const windowS = (t - from - (pausedBefore(session.pauses, t) - pausedBefore(session.pauses, from))) / 1000;
  const pace = windowM > 15 && windowS > 0 ? formatClock(paceToUnit(windowS / (windowM / 1000), unit)) : '-';
  const active = Math.max(0, t - session.points[0]!.tOffsetMs - pausedBefore(session.pauses, t));
  const entry = stepAtOffset(session.log, t);
  const steps = session.steps.map((r) => r.step);
  const pos = entry ? session.steps.findIndex((r) => r.idx === entry.idx) : -1;
  const step = pos >= 0 ? session.steps[pos]!.step : undefined;
  const label = step ? (repLabel(steps, pos) ?? stepName(step)) : undefined;
  return (
    <View style={{ gap: 10 }}>
      {label && step && session.steps.length > 1 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: toneColor(p, stepTone(step)) }} />
          <T v="labelStrong">{label}</T>
        </View>
      )}
      <View style={s.stats}>
        <Stat value={formatClock(Math.floor(active / 1000))} label="Time" />
        <Stat value={metersToUnit(d, unit).toFixed(2)} label={unit === 'mi' ? 'Miles' : 'Kilometers'} />
        <Stat value={pace} label={`Pace /${unit}`} />
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="title" num>
        {value}
      </T>
      <T v="caption" tone="secondary">
        {label}
      </T>
    </View>
  );
}

/** The workout's structure by wall-clock time, with a draggable thumb. */
const Scrubber = memo(function Scrubber({
  session,
  start,
  end,
  thumb,
  onSeek,
  onScrubStart,
}: {
  session: SessionDetail;
  start: number;
  end: number;
  thumb: { value: number };
  onSeek: (t: number) => void;
  onScrubStart: () => void;
}) {
  const p = usePalette();
  const width = useSharedValue(1);
  const span = Math.max(1, end - start);
  const segments = useMemo(() => {
    const out: { flex: number; color: string }[] = [];
    if (session.log.length === 0) return [{ flex: 1, color: p.run.color }];
    for (const e of session.log) {
      const a = Math.max(start, e.startOffsetMs);
      const b = Math.min(end, e.endOffsetMs);
      const step = session.steps.find((r) => r.idx === e.idx)?.step;
      if (b > a) out.push({ flex: (b - a) / span, color: step ? toneColor(p, stepTone(step)) : p.run.color });
    }
    return out.length > 0 ? out : [{ flex: 1, color: p.run.color }];
  }, [session, start, end, span, p]);

  const seekTo = (frac: number) => onSeek(start + frac * span);
  const pan = usePanGesture({
    minDistance: 0,
    onBegin: (e) => {
      'worklet';
      thumb.value = Math.min(1, Math.max(0, e.x / width.value));
      scheduleOnRN(onScrubStart);
      scheduleOnRN(haptic.tick);
      scheduleOnRN(seekTo, thumb.value);
    },
    onUpdate: (e) => {
      'worklet';
      thumb.value = Math.min(1, Math.max(0, e.x / width.value));
      scheduleOnRN(seekTo, thumb.value);
    },
  });

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: thumb.value * width.value - 9 }] }));
  const onLayout = (e: LayoutChangeEvent) => {
    width.value = Math.max(1, e.nativeEvent.layout.width);
  };

  return (
    <GestureDetector gesture={pan}>
      <View accessibilityRole="adjustable" accessibilityLabel="Replay position" style={{ height: 32, justifyContent: 'center' }} onLayout={onLayout} hitSlop={{ top: 8, bottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 2, height: 8 }}>
          {segments.map((seg, i) => (
            <View key={i} style={{ flex: seg.flex, borderRadius: 4, backgroundColor: seg.color }} />
          ))}
        </View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, width: 18, height: 18, borderRadius: 9, backgroundColor: p.surface, borderWidth: 2, borderColor: p.text }, thumbStyle]} />
      </View>
    </GestureDetector>
  );
});

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  panel: { backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 18, gap: 14 },
  stats: { flexDirection: 'row', gap: 10 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
