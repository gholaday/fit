import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { dismissSnack, useSnack } from '@/data/store';
import { createStyles, motion, usePalette } from '@/theme';
import { T } from './primitives';

const TAB_BAR = 64;

/** One snackbar for the whole app: confirmations, Undo and the back-to-back note. */
export function Snackbar() {
  const snack = useSnack();
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!snack) return;
    const t = setTimeout(() => dismissSnack(snack.id), snack.note ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [snack]);

  if (!snack) return null;
  return (
    <Animated.View
      key={snack.id}
      entering={FadeIn.duration(motion.fast)}
      exiting={FadeOut.duration(motion.fast)}
      style={[s.wrap, { bottom: TAB_BAR + insets.bottom + 10 }]}
      accessibilityLiveRegion="polite"
    >
      <View style={s.bar}>
        <View style={s.line}>
          <T v="label" color={p.onPrimary} style={{ flex: 1 }}>
            {snack.message}
          </T>
          {snack.actionLabel && (
            <Pressable
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                dismissSnack(snack.id);
                snack.onAction?.();
              }}
            >
              <T v="labelStrong" color={p.onPrimary} style={{ textDecorationLine: 'underline' }}>
                {snack.actionLabel}
              </T>
            </Pressable>
          )}
        </View>
        {snack.note && (
          <View style={[s.line, s.note]}>
            <T v="caption" color={p.onPrimary} style={{ flex: 1, opacity: 0.8 }}>
              {snack.note}
            </T>
            {snack.noteActionLabel && (
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  dismissSnack(snack.id);
                  snack.onNoteAction?.();
                }}
              >
                <T v="labelStrong" color={p.onPrimary} style={{ textDecorationLine: 'underline' }}>
                  {snack.noteActionLabel}
                </T>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const useStyles = createStyles((p) => ({
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: { backgroundColor: p.primary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 24 },
  note: { borderTopWidth: 1, borderTopColor: p.scheme === 'dark' ? 'rgba(17,18,20,0.15)' : 'rgba(247,247,248,0.15)', paddingTop: 8 },
}));
