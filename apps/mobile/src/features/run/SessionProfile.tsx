/**
 * The summary's top card for runs without a route (treadmill, timer, or GPS that never
 * locked): the run's shape over time instead of an empty map. Each step is a block as wide
 * as its time and as tall as its effort, in its step color, with the heart rate trace on
 * top when there is one. Static SVG drawn once.
 */
import { type SessionDetail, type StructureTone, downsampleHr, formatClock } from '@fit/core';
import { memo, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { createStyles, type Palette, toneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';
import { useUnits } from '@/data/store';
import { formatSpeed } from './speed';
import { stepName, stepTone } from './steps';

const CHART_H = 132;
const HEIGHT: Record<StructureTone, number> = { walk: 0.32, easy: 0.55, hard: 0.78, sprint: 1 };

interface Block {
  x: number;
  w: number;
  h: number;
  color: string;
}

function blocks(session: SessionDetail, p: Palette, width: number, endMs: number): Block[] {
  const x = (ms: number) => (ms / endMs) * width;
  const rows = session.log.filter((e) => !e.skipped && e.endOffsetMs > e.startOffsetMs);
  if (rows.length === 0) return [{ x: 0, w: width, h: HEIGHT.easy * CHART_H, color: p.run.color }];
  return rows.map((e) => {
    const step = session.steps.find((r) => r.idx === e.idx)?.step;
    const tone = step ? stepTone(step) : 'easy';
    // A hairline gap between blocks keeps short steps readable.
    return { x: x(e.startOffsetMs), w: Math.max(1.5, x(e.endOffsetMs) - x(e.startOffsetMs) - 1.5), h: HEIGHT[tone] * CHART_H, color: toneColor(p, tone) };
  });
}

function hrPath(session: SessionDetail, width: number, endMs: number): string {
  const pts = downsampleHr(session.hr, 400);
  if (pts.length < 2) return '';
  const lo = Math.min(...pts.map((q) => q.bpm)) - 8;
  const hi = Math.max(...pts.map((q) => q.bpm)) + 4;
  let d = '';
  let prev: number | undefined;
  for (const q of pts) {
    const move = prev === undefined || q.tOffsetMs - prev > 30_000;
    d += `${move ? 'M' : 'L'}${((q.tOffsetMs / endMs) * width).toFixed(1)},${(CHART_H - ((q.bpm - lo) / (hi - lo)) * CHART_H).toFixed(1)}`;
    prev = q.tOffsetMs;
  }
  return d;
}

export const SessionProfile = memo(function SessionProfile({ session }: { session: SessionDetail }) {
  const s = useStyles();
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const endMs = Math.max(1, session.endedAt ? Date.parse(session.endedAt) - Date.parse(session.startedAt) : (session.log[session.log.length - 1]?.endOffsetMs ?? 1));
  const shown = session.steps.filter((r) => !r.skipped);
  const title = session.mode === 'treadmill' ? 'Treadmill' : session.mode === 'timer' ? 'Timer' : 'No route recorded';
  const unit = useUnits().distance;
  const steps = shown.length > 1 ? `${shown.length} steps` : shown[0] ? stepName(shown[0].step) : 'Indoor run';
  // Treadmill: the average belt speed, the number the console shows.
  const sub = session.mode === 'treadmill' && session.distanceM > 20 && session.elapsedMs > 0 ? `${steps}, average ${formatSpeed((session.distanceM / session.elapsedMs) * 3600, unit)}` : steps;
  const hasHr = session.hr.length > 1;

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.badge}>{session.mode === 'outdoor' ? <Icons.location size={16} color={p.run.onTint} /> : <Icons.run size={16} color={p.run.onTint} />}</View>
        <View style={{ flex: 1 }}>
          <T v="labelStrong">{title}</T>
          <T v="caption" tone="secondary">
            {sub}
          </T>
        </View>
        {hasHr && (
          <View style={s.key}>
            <View style={[s.keyLine, { backgroundColor: p.text }]} />
            <T v="micro" tone="secondary">
              Heart rate
            </T>
          </View>
        )}
      </View>

      <View style={{ height: CHART_H }} onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))} accessibilityLabel={`Run profile, ${formatClock(Math.round(session.elapsedMs / 1000))}, ${sub}`}>
        {width > 0 && (
          <Svg width={width} height={CHART_H}>
            {blocks(session, p, width, endMs).map((b, i) => (
              <Rect key={i} x={b.x} y={CHART_H - b.h} width={b.w} height={b.h} rx={Math.min(6, b.w / 2)} fill={b.color} opacity={0.85} />
            ))}
            {hasHr && <Path d={hrPath(session, width, endMs)} stroke={p.text} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
          </Svg>
        )}
      </View>

      <View style={s.axis}>
        <T v="micro" tone="tertiary" num>
          0:00
        </T>
        <T v="micro" tone="tertiary" num>
          {formatClock(Math.round(endMs / 1000))}
        </T>
      </View>
    </View>
  );
});

const useStyles = createStyles((p) => ({
  card: { height: 240, borderRadius: 20, backgroundColor: p.surface, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, justifyContent: 'space-between' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 32, height: 32, borderRadius: 16, backgroundColor: p.run.tint, alignItems: 'center', justifyContent: 'center' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyLine: { width: 14, height: 2, borderRadius: 1 },
  axis: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 },
}));
