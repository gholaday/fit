/**
 * An activity done today that no plan item claims: a free run, a quick log or a saved
 * Health Connect workout. Drawn like a done checklist row; recorded runs open their summary.
 */
import type { Lane } from '@fit/core';
import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, usePalette } from '@/theme';
import { type AppIcon, Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';

export interface DoneActivity {
  key: string;
  title: string;
  detail: string;
  /** Tile color. */
  lane: Lane;
  icon: AppIcon;
  onPress?: () => void;
}

export const DoneActivityCard = memo(function DoneActivityCard({ activity: a }: { activity: DoneActivity }) {
  const s = useStyles();
  const p = usePalette();
  const c = laneColor(p, a.lane);
  const Icon = a.icon;
  const onPress = a.onPress;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${a.title}, ${a.detail}, done`}
      accessibilityHint={onPress ? 'Opens the run summary' : undefined}
      disabled={!onPress}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={s.row}
    >
      <View style={[s.tile, { backgroundColor: c.tint }]}>
        <Icon size={20} color={c.color} />
      </View>
      <View style={{ flex: 1 }}>
        <T v="bodyMedium" tone="secondary">
          {a.title}
        </T>
        <T v="caption" tone="tertiary" num>
          {a.detail}
        </T>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icons.check size={14} color={p.success} />
        <T v="captionMedium" color={p.success}>
          Done
        </T>
        {onPress && <Icons.chevronRight size={14} color={p.textTertiary} />}
      </View>
    </Pressable>
  );
});

const useStyles = createStyles((p) => ({
  row: { backgroundColor: p.doneRow, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60 },
  tile: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
}));
