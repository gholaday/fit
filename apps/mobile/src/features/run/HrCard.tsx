/**
 * Heart rate on the run summary (spec §7, §11): average and max, a line chart of the
 * merged trace (downsampled to 600 points), time in each zone with a Z1 to Z5 bar, and for
 * long steady runs the decoupling and the run/walk split. Static SVG drawn once.
 */
import { type HrStats, type HrZoneBand, type SessionDetail, type SessionStats, downsampleHr, formatClock } from '@fit/core';
import { memo, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';

const CHART_H = 120;

function linePath(session: SessionDetail, width: number): { d: string; lo: number; hi: number } {
  const pts = downsampleHr(session.hr, 600);
  const endMs = Math.max(1, ...pts.map((x) => x.tOffsetMs));
  const lo = Math.min(...pts.map((x) => x.bpm)) - 5;
  const hi = Math.max(...pts.map((x) => x.bpm)) + 5;
  const y = (bpm: number) => CHART_H - ((bpm - lo) / (hi - lo)) * CHART_H;
  let d = '';
  let prev: number | undefined;
  for (const pt of pts) {
    // A long silence breaks the line instead of drawing a straight bridge across it.
    const move = prev === undefined || pt.tOffsetMs - prev > 30_000;
    d += `${move ? 'M' : 'L'}${((pt.tOffsetMs / endMs) * width).toFixed(1)},${y(pt.bpm).toFixed(1)}`;
    prev = pt.tOffsetMs;
  }
  return { d, lo, hi };
}

export const HrCard = memo(function HrCard({ session, stats, zones, run }: { session: SessionDetail; stats: HrStats; zones: readonly HrZoneBand[] | undefined; run?: SessionStats }) {
  const s = useStyles();
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const chart = width > 0 ? linePath(session, width) : undefined;
  const totalZoneS = stats.zoneSeconds.reduce((a, b) => a + b, 0);

  return (
    <View style={s.card}>
      <T v="headline" style={s.title}>
        Heart rate
      </T>
      {session.hrFromHealth && (
        <View style={s.banner}>
          <Icons.info size={16} color={p.run.onTint} />
          <T v="label" color={p.run.onTint}>
            Heart rate added from Garmin
          </T>
        </View>
      )}
      <View style={s.stats}>
        <View style={{ flex: 1 }}>
          <T v="title" num>
            {`${stats.avgBpm}`}
          </T>
          <T v="caption" tone="secondary">
            Average bpm
          </T>
        </View>
        <View style={{ flex: 1 }}>
          <T v="title" num>
            {`${stats.maxBpm}`}
          </T>
          <T v="caption" tone="secondary">
            Max bpm
          </T>
        </View>
      </View>

      <View style={{ height: CHART_H, marginVertical: 8 }} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))} accessibilityLabel={`Heart rate chart, average ${stats.avgBpm} bpm, max ${stats.maxBpm} bpm`}>
        {chart && (
          <>
            <Svg width={width} height={CHART_H}>
              <Path d={chart.d} stroke={p.run.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </Svg>
            <T v="micro" tone="tertiary" style={[s.axis, { top: 0 }]}>
              {`${Math.round(chart.hi)} bpm`}
            </T>
            <T v="micro" tone="tertiary" style={[s.axis, { bottom: 0 }]}>
              {`${Math.round(chart.lo)} bpm`}
            </T>
          </>
        )}
      </View>

      {zones && totalZoneS > 0 && (
        <View style={{ gap: 6, paddingBottom: 8 }}>
          <View style={s.dist} accessibilityLabel={`Time in zone, ${Math.round((stats.zoneSeconds[1] / totalZoneS) * 100)}% in Zone 2`}>
            {stats.zoneSeconds.map((sec, i) => (sec > 0 ? <View key={i} style={{ flex: sec, backgroundColor: ZONE_TONE(p)[i] }} /> : null))}
          </View>
          <T v="label" tone="secondary" num>{`${Math.round((stats.zoneSeconds[1] / totalZoneS) * 100)}% in Zone 2`}</T>
          {stats.zoneSeconds.map((sec, i) => {
            const band = zones[i];
            return (
              <View key={i} style={s.zoneRow}>
                <T v="label" tone="secondary" style={{ width: 28 }}>
                  {`Z${i + 1}`}
                </T>
                <View style={s.zoneTrack}>
                  <View style={[s.zoneFill, { width: `${(sec / totalZoneS) * 100}%`, backgroundColor: ZONE_TONE(p)[i] }]} />
                </View>
                <T v="label" num style={{ width: 52, textAlign: 'right' }}>
                  {formatClock(sec)}
                </T>
                <T v="micro" tone="tertiary" num style={{ width: 64, textAlign: 'right' }}>
                  {band ? `${band.minBpm}-${band.maxBpm} bpm` : ''}
                </T>
              </View>
            );
          })}
        </View>
      )}

      {run?.runWalk && run.runWalk.runS + run.runWalk.walkS > 0 && (
        <View style={s.extra}>
          <T v="bodyMedium">Run and walk</T>
          <T v="label" tone="secondary" num>
            {`Ran ${formatClock(run.runWalk.runS)}, walked ${formatClock(run.runWalk.walkS)}, ${Math.round((run.runWalk.runS / (run.runWalk.runS + run.runWalk.walkS)) * 100)}% running`}
          </T>
        </View>
      )}
      {run?.decouplingPct !== undefined && (
        <View style={s.extra}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T v="bodyMedium">Decoupling</T>
            <T v="bodyStrong" num>{`${run.decouplingPct.toFixed(1)}%`}</T>
          </View>
          <T v="caption" tone="secondary">
            How much your heart rate drifted against pace from the first half to the second. Under 5% is good.
          </T>
        </View>
      )}
    </View>
  );
});

/** Zone 2 stands out; the other zones step from light to dark. */
const ZONE_TONE = (p: ReturnType<typeof usePalette>) => [p.run.pending, p.run.color, p.hard.color, p.sprint.color, p.sprint.onTint];

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 16, paddingHorizontal: 14, paddingBottom: 8 },
  title: { paddingTop: 14, paddingBottom: 6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: p.run.tint, marginBottom: 8 },
  stats: { flexDirection: 'row', gap: 10 },
  axis: { position: 'absolute', right: 0 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  zoneTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: p.inset, overflow: 'hidden' },
  zoneFill: { height: 8, borderRadius: 4 },
  dist: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: p.inset, marginBottom: 2 },
  extra: { borderTopWidth: 1, borderTopColor: p.divider, paddingVertical: 10, gap: 4 },
}));
