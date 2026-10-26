import { memo } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { thousands } from '@/lib/format';
import { createStyles, laneColor, usePalette } from '@/theme';
import { Icons, LANE_ICON } from '@/ui/icons';
import { T } from '@/ui/primitives';
import type { DaySummary } from './daySummary';

const R = 42;
const C = 2 * Math.PI * R;

/** Steps ring. `steps` is undefined until Health Connect has synced today; the ring then shows the goal only. */
export const StepsRing = memo(function StepsRing({ steps, goal, size = 96 }: { steps: number | undefined; goal: number; size?: number }) {
  const p = usePalette();
  const met = steps !== undefined && steps >= goal;
  const frac = steps === undefined ? 0 : Math.min(1, steps / goal);
  const label = steps === undefined ? `Step goal ${thousands(goal)}, steps not synced` : `${thousands(steps)} of ${thousands(goal)} steps`;
  return (
    <View style={{ width: size, height: size }} accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <Circle cx={48} cy={48} r={R} fill="none" stroke={p.ringTrack} strokeWidth={8} />
        {frac > 0 && (
          <Circle cx={48} cy={48} r={R} fill="none" stroke={met ? p.success : p.primary} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${frac * C} ${C}`} transform="rotate(-90 48 48)" />
        )}
      </Svg>
      {size >= 64 && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <T v="statSm" style={{ fontSize: steps === undefined ? 14 : 18 }} tone={steps === undefined ? 'secondary' : 'text'}>
            {steps === undefined ? 'Steps' : thousands(steps)}
          </T>
          <T v="tiny" tone="secondary" style={{ fontWeight: '400' }}>
            {met ? 'goal met' : `of ${thousands(goal)}`}
          </T>
        </View>
      )}
    </View>
  );
});

/** One segment per item today, colored by lane, filled when done. */
export const DayStrip = memo(function DayStrip({ segments, height = 8 }: { segments: DaySummary['segments']; height?: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {segments.map((seg, i) => {
        const c = laneColor(p, seg.lane);
        const bg = seg.status === 'done' ? (seg.lane === 'stretch' ? p.success : c.color) : seg.status === 'skipped' ? p.ringTrack : c.pending;
        return <View key={i} style={{ flex: 1, height, borderRadius: height / 2, backgroundColor: bg }} />;
      })}
    </View>
  );
});

export const DayWidget = memo(function DayWidget({ summary, stepGoal, steps }: { summary: DaySummary; stepGoal: number; steps?: number }) {
  const s = useStyles();
  const p = usePalette();
  const LineIcon = summary.line ? LANE_ICON[summary.line.lane] : undefined;
  const SubIcon = summary.sub?.icon === 'clock' ? Icons.clock : Icons.calendar;
  return (
    <View style={s.card}>
      <StepsRing steps={steps} goal={stepGoal} />
      <View style={s.right}>
        <T v="headline" numberOfLines={1}>
          {summary.headline}
        </T>
        {summary.segments.length > 0 && <DayStrip segments={summary.segments} />}
        {summary.line && LineIcon && (
          <View style={s.line}>
            <LineIcon size={14} color={laneColor(p, summary.line.lane).color} />
            <T v="label" style={{ flex: 1 }} numberOfLines={2}>
              {summary.line.text}
            </T>
          </View>
        )}
        {summary.sub && (
          <View style={s.line}>
            <SubIcon size={14} color={p.textTertiary} />
            <T v="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
              {summary.sub.text}
            </T>
          </View>
        )}
      </View>
    </View>
  );
});

/** What the widget shrinks to while the checklist scrolls. */
export const SlimBar = memo(function SlimBar({ summary, steps }: { summary: DaySummary; steps?: number }) {
  const s = useStyles();
  return (
    <View style={s.slim}>
      <T v="labelStrong" numberOfLines={1}>
        {summary.total === 0 ? 'Rest day' : `${summary.done} of ${summary.total} done`}
      </T>
      <View style={{ flex: 1 }}>{summary.segments.length > 0 && <DayStrip segments={summary.segments} height={6} />}</View>
      <T v="caption" tone="secondary" num>
        {steps === undefined ? 'Steps not synced' : `${thousands(steps)} steps`}
      </T>
    </View>
  );
});

const useStyles = createStyles((p) => ({
  card: { backgroundColor: p.surface, borderRadius: 20, padding: 16, flexDirection: 'row', gap: 16, alignItems: 'center' },
  right: { flex: 1, minWidth: 0, gap: 9 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slim: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: p.surface },
}));
