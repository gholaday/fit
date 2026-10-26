/**
 * Small chart pieces for Stats: stacked bars from plain Views and a trend line in SVG.
 * No chart library; each chart draws a handful of shapes.
 */
import type { Lane } from '@fit/core';
import { type ReactNode, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { createStyles, usePalette } from '@/theme';
import { LaneTile, T } from '@/ui/primitives';

export function Card({ title, right, children }: { title?: string; right?: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.card}>
      {(title || right) && (
        <View style={s.head}>
          {title && <T v="headline">{title}</T>}
          {right && (
            <T v="caption" tone="secondary" num>
              {right}
            </T>
          )}
        </View>
      )}
      {children}
    </View>
  );
}

/** "Morning stretch, 5 of 7" with a thin progress bar, as in the Stats mockup. */
export function ProgressRow({ lane, name, value, frac }: { lane: Lane; name: string; value: string; frac: number }) {
  const s = useStyles();
  const p = usePalette();
  const color = lane === 'run' ? p.run.color : lane === 'workout' ? p.strength.color : p.stretch.color;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <LaneTile lane={lane} size={32} />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <T v="bodyMedium" numberOfLines={1} style={{ flex: 1, fontSize: 14 }}>
            {name}
          </T>
          <T v="labelStrong" num>
            {value}
          </T>
        </View>
        <View style={s.track}>
          <View style={{ width: `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`, height: '100%', backgroundColor: color }} />
        </View>
      </View>
    </View>
  );
}

export interface Bar {
  label: string;
  /** Stacked bottom to top. */
  parts: readonly { value: number; color: string }[];
  /** Dims the others when one bar is the current period. */
  current?: boolean;
}

/** Stacked bars on a shared scale, labels underneath. An optional goal line sits across. */
export function StackBars({ bars, height = 80, goal, accessibilityLabel }: { bars: readonly Bar[]; height?: number; goal?: number; accessibilityLabel: string }) {
  const p = usePalette();
  const totals = bars.map((b) => b.parts.reduce((sum, x) => sum + x.value, 0));
  const max = Math.max(goal ?? 0, ...totals, 1);
  const anyCurrent = bars.some((b) => b.current);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: bars.length > 10 ? 4 : 8 }}>
        {goal !== undefined && <View style={{ position: 'absolute', left: 0, right: 0, bottom: (goal / max) * height, borderTopWidth: 1, borderStyle: 'dashed', borderColor: p.dashed }} />}
        {bars.map((b, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(totals[i]! > 0 ? 3 : 0, (totals[i]! / max) * height), borderRadius: 4, overflow: 'hidden', opacity: anyCurrent && !b.current ? 0.55 : 1, flexDirection: 'column-reverse' }}>
            {b.parts.map((part, j) => (part.value > 0 ? <View key={j} style={{ flex: part.value, backgroundColor: part.color }} /> : null))}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: bars.length > 10 ? 4 : 8, marginTop: 4 }}>
        {bars.map((b, i) => (
          <T key={i} v="tiny" tone="tertiary" align="center" numberOfLines={1} style={{ flex: 1 }}>
            {b.label}
          </T>
        ))}
      </View>
    </View>
  );
}

/** A line through the points, newest at the right with a dot. `invert` puts smaller values higher (pace). */
export function TrendLine({ values, color, height = 80, invert, accessibilityLabel }: { values: readonly number[]; color: string; height?: number; invert?: boolean; accessibilityLabel: string }) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pad = 6;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : pad + (i / (values.length - 1)) * (width - 2 * pad);
    const f = (v - lo) / span;
    const y = pad + (invert ? f : 1 - f) * (height - 2 * pad - 6);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke={p.divider} strokeWidth={1} />
          {pts.length > 1 && <Polyline points={pts.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
          {last && <Circle cx={last[0]} cy={last[1]} r={4.5} fill={color} />}
        </Svg>
      )}
    </View>
  );
}

export function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14 }}>
      {items.map((it) => (
        <View key={it.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: it.color }} />
          <T v="micro" tone="secondary">
            {it.label}
          </T>
        </View>
      ))}
    </View>
  );
}

/** Big number with a caption under it, for a row of totals. */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1 }}>
      <T v="stat" num>
        {value}
      </T>
      <T v="micro" tone="secondary">
        {label}
      </T>
    </View>
  );
}

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 18, padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  track: { height: 5, borderRadius: 3, backgroundColor: p.divider, overflow: 'hidden' },
}));
