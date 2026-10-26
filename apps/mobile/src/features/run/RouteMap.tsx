/**
 * Route map on the summary (spec §5 "Route map & replay"): MapLibre with OpenFreeMap tiles,
 * start and finish dots and mile markers. The line is colored by step, pace, heart rate or
 * elevation (chips under the map, with a low to high legend). Static so the page scrolls;
 * tapping the line shows the time, pace and heart rate there, and Replay opens the
 * full-screen replay. Lazy-loaded by the summary.
 */
import { type DistanceUnit, type RouteColorBy, type SessionDetail, formatClock, formatPace, routeValues, valueRange } from '@fit/core';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { type Palette, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Chip, T } from '@/ui/primitives';
import { buildRoute, type ColorStop, gradient, MAP_FONT, MAP_STYLE, nearestDrawn, pausedBefore, RAMP_COLORS, type RouteGeometry, valueStops } from './route';

const HEIGHT = 240;
const FT_PER_M = 3.28084;
const LABEL: Record<RouteColorBy, string> = { step: 'Step', pace: 'Pace', hr: 'HR', elevation: 'Elevation' };

const neutralColor = (p: Palette) => (p.scheme === 'dark' ? '#5A5D66' : '#B9BAC0');

/** `replay` off for routes that are not recorded sessions (a watch run's GPX file). */
export default function RouteMap({ session, replay = true }: { session: SessionDetail; replay?: boolean }) {
  const p = usePalette();
  const unit = useUnits().distance;
  const route = useMemo(() => buildRoute(session, p, unit), [session, p, unit]);
  // One value per drawn point for each coloring, computed once; the tap readout reuses pace and HR.
  const values = useMemo(
    () => ({ pace: routeValues(route.drawn, 'pace'), hr: routeValues(route.drawn, 'hr', session.hr), elevation: routeValues(route.drawn, 'elevation') }),
    [route, session.hr],
  );
  const [by, setBy] = useState<RouteColorBy>('step');
  const [picked, setPicked] = useState<number>();

  const options = (['step', 'pace', 'hr', 'elevation'] as const).filter((k) => k === 'step' || values[k].some((v) => v !== undefined));
  const range = by === 'step' ? undefined : valueRange(values[by]);
  const stops = by === 'step' || !range ? route.stops : valueStops(route, values[by], range, neutralColor(p), by === 'pace');

  const open = () => {
    haptic.commit();
    router.push({ pathname: '/replay/[id]', params: { id: session.id } });
  };

  // Taps within about 6% of the route's size count as on the line.
  const [w, s, e, n] = route.bounds;
  const reachM = Math.max(30, 0.06 * Math.hypot((e - w) * Math.cos((((s + n) / 2) * Math.PI) / 180) * 111_320, (n - s) * 110_540));
  const pick = (lng: number, lat: number) => {
    const i = nearestDrawn(route, lng, lat, reachM);
    if (i === undefined && picked === undefined) return;
    haptic.tick();
    setPicked(i);
  };

  const pt = picked === undefined ? undefined : route.drawn[picked];
  const readout = pt && {
    time: formatClock(Math.round((pt.tOffsetMs - pausedBefore(session.pauses, pt.tOffsetMs)) / 1000)),
    pace: values.pace[picked!],
    bpm: values.hr[picked!],
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ height: HEIGHT, borderRadius: 20, overflow: 'hidden', backgroundColor: p.inset }}>
        <Map
          mapStyle={p.scheme === 'dark' ? MAP_STYLE.dark : MAP_STYLE.light}
          style={{ flex: 1 }}
          dragPan={false}
          touchZoom={false}
          doubleTapZoom={false}
          doubleTapHoldZoom={false}
          touchRotate={false}
          touchPitch={false}
          logo={false}
          attributionPosition={{ bottom: 8, left: 8 }}
          onPress={(ev) => pick(ev.nativeEvent.lngLat[0], ev.nativeEvent.lngLat[1])}
        >
          <Camera initialViewState={{ bounds: route.bounds, padding: { top: 28, right: 28, bottom: 28, left: 28 } }} />
          <RouteLayers route={route} p={p} stops={stops} />
          {pt && (
            <GeoJSONSource id="picked" data={{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] } }}>
              <Layer type="circle" id="picked-dot" paint={{ 'circle-radius': 7, 'circle-color': p.text, 'circle-stroke-color': p.surface, 'circle-stroke-width': 3 }} />
            </GeoJSONSource>
          )}
        </Map>
        {readout && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 10, top: 10, flexDirection: 'row', gap: 14, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: p.surface }}>
            <Readout value={readout.time} label="Time" />
            {readout.pace !== undefined && <Readout value={formatPace(readout.pace, unit)} label="Pace" />}
            {readout.bpm !== undefined && <Readout value={`${readout.bpm} bpm`} label="HR" />}
          </View>
        )}
        {replay && (
        <Pressable accessibilityRole="button" accessibilityLabel="Replay run" onPress={open} style={{ position: 'absolute', right: 10, bottom: 10, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: p.text, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icons.play size={12} color={p.bg} />
          <T v="labelStrong" color={p.bg}>
            Replay
          </T>
        </Pressable>
        )}
      </View>

      {options.length > 1 && (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {options.map((k) => (
            <Chip key={k} label={LABEL[k]} on={by === k} onPress={() => setBy(k)} />
          ))}
        </View>
      )}
      {by !== 'step' && range && <Legend by={by} range={range} unit={unit} />}
    </View>
  );
}

function Readout({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <T v="labelStrong" num>
        {value}
      </T>
      <T v="micro" tone="secondary">
        {label}
      </T>
    </View>
  );
}

/** Low to high bar under the chips. Pace reads slower to faster, so the warm end is always "more". */
function Legend({ by, range, unit }: { by: Exclude<RouteColorBy, 'step'>; range: [number, number]; unit: DistanceUnit }) {
  const fmt = (v: number) => (by === 'pace' ? formatPace(v, unit) : by === 'hr' ? `${Math.round(v)} bpm` : unit === 'mi' ? `${Math.round(v * FT_PER_M)} ft` : `${Math.round(v)} m`);
  const [left, right] = by === 'pace' ? [range[1], range[0]] : range;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <T v="micro" tone="secondary" num>
        {fmt(left)}
      </T>
      <View style={{ flex: 1, height: 8 }}>
        <Svg width="100%" height={8}>
          <Defs>
            <LinearGradient id="legend" x1="0" y1="0" x2="1" y2="0">
              {RAMP_COLORS.map((c, i) => (
                <Stop key={c} offset={i / (RAMP_COLORS.length - 1)} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height={8} rx={4} fill="url(#legend)" />
        </Svg>
      </View>
      <T v="micro" tone="secondary" num>
        {fmt(right)}
      </T>
    </View>
  );
}

/**
 * The colored route, markers and endpoints. `stops` overrides the step colors. `upTo` draws
 * the trail to that fraction over a faint full route.
 */
export const RouteLayers = memo(function RouteLayers({ route, p, upTo, stops }: { route: RouteGeometry; p: Palette; upTo?: number; stops?: readonly ColorStop[] }) {
  return (
    <>
      <GeoJSONSource id="route" data={route.line} lineMetrics>
        <Layer
          type="line"
          id="route-casing"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': p.surface, 'line-width': 8, 'line-opacity': upTo === undefined ? 0.9 : 0.6 }}
        />
        <Layer type="line" id="route-line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-width': 4.5, 'line-gradient': gradient(stops ?? route.stops, upTo, neutralColor(p)) }} />
      </GeoJSONSource>
      <GeoJSONSource id="markers" data={route.markers}>
        <Layer type="circle" id="marker-dot" paint={{ 'circle-radius': 9, 'circle-color': p.surface, 'circle-stroke-color': p.text, 'circle-stroke-width': 1.5 }} />
      </GeoJSONSource>
      {/* Labels need glyphs from the tile server. Their own source, so the dots still draw when glyphs can't load. */}
      <GeoJSONSource id="marker-labels" data={route.markers}>
        <Layer type="symbol" id="marker-label" layout={{ 'text-field': ['get', 'label'], 'text-font': MAP_FONT, 'text-size': 10, 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': p.text }} />
      </GeoJSONSource>
      <GeoJSONSource id="finish" data={route.finish}>
        <Layer type="circle" id="finish-dot" paint={{ 'circle-radius': 6, 'circle-color': p.text, 'circle-stroke-color': p.surface, 'circle-stroke-width': 2 }} />
      </GeoJSONSource>
      <GeoJSONSource id="start" data={route.start}>
        <Layer type="circle" id="start-dot" paint={{ 'circle-radius': 6, 'circle-color': p.success, 'circle-stroke-color': p.surface, 'circle-stroke-width': 2 }} />
      </GeoJSONSource>
    </>
  );
});
