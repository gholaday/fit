/**
 * Weight chart (spec §12 Weight): the trend line, each day's weigh-in as a dot, and the
 * goal's plan line dashed. Dates run left to right across `from` to `to`.
 */
import { type IsoDate, type TrendPoint, type WeightGoal, type WeightUnit, diffDays, expectedGoalDate, kgToUnit, planKgOn } from '@fit/core';
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { monthDay } from '@/lib/format';
import { usePalette } from '@/theme';
import { T } from '@/ui/primitives';

const PAD = 6;
const GUTTER = 60;

interface WeightChartProps {
  points: readonly TrendPoint[];
  from: IsoDate;
  to: IsoDate;
  unit: WeightUnit;
  goal?: WeightGoal;
  height?: number;
  /** Value labels at the top and bottom, and dates under the ends. */
  axes?: boolean;
}

export function WeightChart({ points, from, to, unit, goal, height = 120, axes }: WeightChartProps) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const span = Math.max(1, diffDays(from, to));
  // The plan line from the later of its start and `from` to the earlier of its end and `to`.
  const plan = goal && goal.status !== 'stopped' ? planSegment(goal, from, to) : undefined;
  const values = [...points.flatMap((pt) => [pt.kg, pt.weighInKg]), ...(plan ? [plan[0].kg, plan[1].kg] : [])];
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = Math.max(hi - lo, 0.5);
  const mid = (hi + lo) / 2;
  const top = mid + range / 2;
  // With axes, the value labels get their own gutter on the right.
  const plot = axes ? width - GUTTER : width;
  const x = (d: IsoDate) => PAD + (diffDays(from, d) / span) * (plot - 2 * PAD);
  const y = (kg: number) => PAD + ((top - kg) / range) * (height - 2 * PAD);
  const trend = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${x(pt.date)} ${y(pt.kg)}`).join(' ');
  const last = points[points.length - 1];
  const label = last ? `Weight trend, ${kgToUnit(last.kg, unit).toFixed(1)} ${unit} on ${monthDay(last.date)}` : 'Weight trend';

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ gap: 4 }}>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Line x1={0} y1={height - 1} x2={plot} y2={height - 1} stroke={p.divider} strokeWidth={1} />
            {axes && <Line x1={0} y1={PAD} x2={plot} y2={PAD} stroke={p.divider} strokeWidth={1} strokeDasharray="2 4" />}
            {plan && <Line x1={x(plan[0].date)} y1={y(plan[0].kg)} x2={x(plan[1].date)} y2={y(plan[1].kg)} stroke={p.textMuted} strokeWidth={1.5} strokeDasharray="5 5" />}
            {points.map((pt) => (
              <Circle key={pt.date} cx={x(pt.date)} cy={y(pt.weighInKg)} r={2.5} fill={p.weight} fillOpacity={0.45} />
            ))}
            {points.length > 1 && <Path d={trend} fill="none" stroke={p.weight} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
            {last && <Circle cx={x(last.date)} cy={y(last.kg)} r={4.5} fill={p.weight} />}
          </Svg>
        )}
        {axes && (
          <>
            <T v="micro" tone="tertiary" num style={{ position: 'absolute', top: 0, right: 0 }}>
              {`${kgToUnit(top, unit).toFixed(1)} ${unit}`}
            </T>
            <T v="micro" tone="tertiary" num style={{ position: 'absolute', bottom: 2, right: 0 }}>
              {`${kgToUnit(top - range, unit).toFixed(1)} ${unit}`}
            </T>
          </>
        )}
      </View>
      {axes && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginRight: GUTTER }}>
          <T v="micro" tone="tertiary">
            {monthDay(from)}
          </T>
          <T v="micro" tone="tertiary">
            {monthDay(to)}
          </T>
        </View>
      )}
    </View>
  );
}

function planSegment(goal: WeightGoal, from: IsoDate, to: IsoDate): [{ date: IsoDate; kg: number }, { date: IsoDate; kg: number }] | undefined {
  const end = expectedGoalDate(goal);
  const a = goal.startDate > from ? goal.startDate : from;
  const b = end < to ? end : to;
  if (a > b) return undefined;
  return [
    { date: a, kg: planKgOn(goal, a) },
    { date: b, kg: planKgOn(goal, b) },
  ];
}
