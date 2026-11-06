/**
 * The floating action pill above the tab bar (spec §14 Orbit). The primary button starts
 * the next item in its lane color ("Start Legs"), then Log and Weigh in. With nothing left
 * to start it is Log activity, and on a rest day Free run joins.
 */
import type { AgendaItem } from '@fit/core';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { haptic } from '@/lib/haptics';
import { createStyles, laneColor, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';

/** Runs open the recorder; scheduled workouts and stretches open the logger or the guided player. */
export function startItem(item: AgendaItem): void {
  haptic.commit();
  if (item.lane === 'run' || item.source.type !== 'schedule') {
    router.push({ pathname: '/run', params: { key: item.key } });
    return;
  }
  router.push({ pathname: item.lane === 'stretch' ? '/stretch/[id]' : '/strength/[id]', params: { id: item.refId, key: item.key } });
}

interface ActionPillProps {
  next?: AgendaItem;
  restDay: boolean;
  onLog: () => void;
  onWeighIn: () => void;
}

export function ActionPill({ next, restDay, onLog, onWeighIn }: ActionPillProps) {
  const s = useStyles();
  const p = usePalette();
  return (
    <View style={s.pill}>
      {next ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Start ${next.title}`} onPress={() => startItem(next)} style={({ pressed }) => [s.btn, s.primary, { backgroundColor: laneColor(p, next.lane).color }, pressed && { opacity: 0.8 }]}>
          <Icons.play size={14} color="#FFFFFF" />
          <T v="bodyStrong" color="#FFFFFF" numberOfLines={1} style={{ flexShrink: 1 }}>
            {`Start ${next.title}`}
          </T>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" onPress={onLog} style={({ pressed }) => [s.btn, { backgroundColor: p.primary }, pressed && { opacity: 0.8 }]}>
          <T v="bodyStrong" color={p.onPrimary} numberOfLines={1}>
            Log activity
          </T>
        </Pressable>
      )}
      {next && <Quiet label="Log" onPress={onLog} />}
      {!next && restDay && (
        <Quiet
          label="Free run"
          onPress={() => {
            haptic.commit();
            router.push('/run');
          }}
        />
      )}
      <Quiet label="Weigh in" onPress={onWeighIn} />
    </View>
  );
}

function Quiet({ label, onPress }: { label: string; onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [s.btn, pressed && { opacity: 0.6 }]}
    >
      <T v="bodyStrong" numberOfLines={1}>
        {label}
      </T>
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  pill: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 12,
    flexDirection: 'row',
    gap: 4,
    padding: 6,
    borderRadius: 30,
    backgroundColor: p.surface,
    borderWidth: p.scheme === 'dark' ? 1 : 0,
    borderColor: p.border,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  btn: { flex: 1, height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 10 },
  primary: { flex: 1.4 },
}));
