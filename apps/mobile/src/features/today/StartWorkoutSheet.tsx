/**
 * Start a lifting workout from Today: an empty one (lifts added as you go) or a saved
 * routine. A routine due today and not done yet starts as that checklist item.
 */
import { formatMinutes } from '@fit/core';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useDayKeys, useFit, useRoutines, useToday } from '@/data/store';
import { EMPTY_WORKOUT } from '@/features/strength/StrengthScreen';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, LaneTile, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

export function StartWorkoutSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const routines = useRoutines().filter((r) => r.kind === 'strength');
  const today = useToday();
  const keys = useDayKeys(today);
  const due = useFit(useShallow((st) => keys.map((k) => st.items[k]!).filter((i) => i.source.type === 'schedule' && i.lane === 'workout' && i.status === 'pending')));

  const start = (id: string) => {
    onClose();
    haptic.commit();
    const key = due.find((i) => i.refId === id)?.key;
    router.push({ pathname: '/strength/[id]', params: key ? { id, key } : { id } });
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Start a workout" scroll>
      <View style={{ gap: 10 }}>
        <Button label="Empty workout" icon={<Icons.plus size={16} color={p.onPrimary} />} onPress={() => start(EMPTY_WORKOUT)} />
        {routines.length > 0 && (
          <View style={s.list}>
            {routines.map((r, i) => (
              <Pressable key={r.id} accessibilityRole="button" onPress={() => start(r.id)} style={({ pressed }) => [s.row, i > 0 && s.divider, pressed && { opacity: 0.6 }]}>
                <LaneTile lane="workout" />
                <View style={{ flex: 1 }}>
                  <T v="bodyMedium">{r.name}</T>
                  <T v="caption" tone="secondary" num>
                    {`${r.itemCount} exercises, about ${formatMinutes(r.estSeconds)}${due.some((d) => d.refId === r.id) ? ', due today' : ''}`}
                  </T>
                </View>
                <Icons.chevronRight size={14} color={p.textTertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

const useStyles = createStyles((p) => ({
  list: { backgroundColor: p.bg, borderRadius: 16, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderTopWidth: 1, borderTopColor: p.divider },
}));
