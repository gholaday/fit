import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles, motion, usePalette } from '@/theme';
import { Icons } from './icons';
import { IconButton, T } from './primitives';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Header left of the close button (e.g. lane tile and two-line title). */
  header?: ReactNode;
  children: ReactNode;
  /** Let long content scroll inside the sheet. */
  scroll?: boolean;
}

/**
 * Bottom sheet over a scrim. Opening slides in on the UI thread (Reanimated layout
 * animation); closing is instant so it never delays the action that closed it.
 */
export function Sheet({ visible, onClose, title, header, children, scroll }: SheetProps) {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  if (!visible) return null;
  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(motion.base)} style={s.scrim}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={s.anchor} pointerEvents="box-none">
        <Animated.View entering={SlideInDown.duration(motion.slow)} style={[s.sheet, { paddingBottom: 20 + insets.bottom }]} accessibilityViewIsModal>
          <View style={s.handle} />
          {(title || header) && (
            <View style={s.head}>
              <View style={{ flex: 1 }}>{header ?? <T v="heading">{title}</T>}</View>
              <IconButton label="Close" bg="inset" onPress={onClose}>
                <Icons.x size={18} color={p.text} />
              </IconButton>
            </View>
          )}
          {scroll ? (
            <ScrollView style={{ maxHeight: 560 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          ) : (
            <View style={{ gap: 14 }}>{children}</View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((p) => ({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.scrim },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 20, gap: 14 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: p.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
