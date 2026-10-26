/**
 * Route map on the summary (spec §5 "Route map & replay"): MapLibre with OpenFreeMap tiles,
 * the line colored by workout step, start and finish dots and mile markers. Static on the
 * summary so the page scrolls; tapping it, or Replay, opens the full-screen replay.
 * Lazy-loaded by the summary.
 */
import type { SessionDetail } from '@fit/core';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { memo, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useUnits } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { type Palette, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';
import { buildRoute, gradient, MAP_FONT, MAP_STYLE, type RouteGeometry } from './route';

const HEIGHT = 240;

export default function RouteMap({ session }: { session: SessionDetail }) {
  const p = usePalette();
  const unit = useUnits().distance;
  const route = useMemo(() => buildRoute(session, p, unit), [session, p, unit]);
  const open = () => {
    haptic.commit();
    router.push({ pathname: '/replay/[id]', params: { id: session.id } });
  };
  return (
    <View style={{ height: HEIGHT, borderRadius: 20, overflow: 'hidden', backgroundColor: p.inset }}>
      <Map mapStyle={p.scheme === 'dark' ? MAP_STYLE.dark : MAP_STYLE.light} style={{ flex: 1 }} dragPan={false} touchZoom={false} doubleTapZoom={false} doubleTapHoldZoom={false} touchRotate={false} touchPitch={false} logo={false} attributionPosition={{ bottom: 8, left: 8 }} onPress={open}>
        <Camera initialViewState={{ bounds: route.bounds, padding: { top: 28, right: 28, bottom: 28, left: 28 } }} />
        <RouteLayers route={route} p={p} />
      </Map>
      <Pressable accessibilityRole="button" accessibilityLabel="Replay run" onPress={open} style={{ position: 'absolute', right: 10, bottom: 10, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: p.text, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icons.play size={12} color={p.bg} />
        <T v="labelStrong" color={p.bg}>
          Replay
        </T>
      </Pressable>
    </View>
  );
}

/** The colored route, markers and endpoints. `upTo` draws the trail to that fraction over a faint full route. */
export const RouteLayers = memo(function RouteLayers({ route, p, upTo }: { route: RouteGeometry; p: Palette; upTo?: number }) {
  return (
    <>
      <GeoJSONSource id="route" data={route.line} lineMetrics>
        <Layer
          type="line"
          id="route-casing"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': p.surface, 'line-width': 8, 'line-opacity': upTo === undefined ? 0.9 : 0.6 }}
        />
        <Layer
          type="line"
          id="route-line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-width': 4.5, 'line-gradient': gradient(route.stops, upTo, p.scheme === 'dark' ? '#5A5D66' : '#B9BAC0') }}
        />
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
