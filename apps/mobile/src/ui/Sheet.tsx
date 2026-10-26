import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Dimensions, KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { createStyles, motion, usePalette } from '@/theme';
import { Icons } from './icons';
import { IconButton, T } from './primitives';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Header left of the close button (e.g. lane tile and two-line title). */
  header?: ReactNode;
  children?: ReactNode;
  /** Let long content scroll inside the sheet. The drag to close then starts from the header. */
  scroll?: boolean;
}

const OFFSCREEN = Dimensions.get('window').height;
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 900;
const EASE_OUT = Easing.out(Easing.cubic);

/**
 * Bottom sheet over a scrim. Opens and closes with a slide on the UI thread, and can be
 * dragged down to close. Closing never waits on the animation: the state that closed it
 * has already changed; the sheet keeps its last content on screen only while sliding out.
 */
export function Sheet({ visible, onClose, title, header, children, scroll }: SheetProps) {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const last = useRef<{ title?: string; header?: ReactNode; children?: ReactNode; scroll?: boolean }>({});
  if (visible) last.current = { title, header, children, scroll };
  const view = visible ? { title, header, children, scroll } : last.current;

  const ty = useSharedValue(OFFSCREEN);
  const height = useSharedValue(OFFSCREEN);

  useEffect(() => {
    if (visible) {
      if (!mounted) setMounted(true);
      // Reopened while sliding out: slide back in from where it is.
      else if (ty.value < OFFSCREEN) ty.value = withTiming(0, { duration: motion.slow, easing: EASE_OUT });
    } else if (mounted) {
      ty.value = withTiming(height.value, { duration: motion.base, easing: EASE_OUT }, (done) => {
        'worklet';
        if (!done) return;
        ty.value = OFFSCREEN;
        scheduleOnRN(setMounted, false);
      });
    }
  }, [visible, mounted, ty, height]);

  const onLayout = (h: number) => {
    height.value = h;
    if (visible && ty.value >= OFFSCREEN) ty.value = h;
    if (visible) ty.value = withTiming(0, { duration: motion.slow, easing: EASE_OUT });
  };

  const pan = usePanGesture({
    activeOffsetY: [-1000, 8],
    failOffsetX: [-24, 24],
    onUpdate: (e) => {
      'worklet';
      ty.value = Math.max(0, e.translationY);
    },
    onDeactivate: (e) => {
      'worklet';
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(onClose);
      } else {
        ty.value = withSpring(0, { damping: 24, stiffness: 260 });
      }
    },
  });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: interpolate(ty.value, [0, Math.max(1, height.value)], [1, 0], 'clamp') }));

  if (!mounted) return null;

  const head = (
    <View style={s.grab}>
      <View style={s.handle} />
      {(view.title || view.header) && (
        <View style={s.head}>
          <View style={{ flex: 1 }}>{view.header ?? <T v="heading">{view.title}</T>}</View>
          <IconButton label="Close" bg="inset" onPress={onClose}>
            <Icons.x size={18} color={p.text} />
          </IconButton>
        </View>
      )}
    </View>
  );

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* A Modal is its own native root on Android, so gestures need their own root view. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[s.scrim, scrimStyle]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <KeyboardAvoidingView behavior="padding" style={s.anchor} pointerEvents="box-none">
          {view.scroll ? (
            <Animated.View onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={[s.sheet, { paddingBottom: 20 + insets.bottom }, sheetStyle]} accessibilityViewIsModal>
              <GestureDetector gesture={pan}>{head}</GestureDetector>
              <ScrollView style={{ maxHeight: OFFSCREEN * 0.68 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {view.children}
              </ScrollView>
            </Animated.View>
          ) : (
            <GestureDetector gesture={pan}>
              <Animated.View onLayout={(e) => onLayout(e.nativeEvent.layout.height)} style={[s.sheet, { paddingBottom: 20 + insets.bottom }, sheetStyle]} accessibilityViewIsModal>
                {head}
                <View style={{ gap: 14 }}>{view.children}</View>
              </Animated.View>
            </GestureDetector>
          )}
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = createStyles((p) => ({
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.scrim },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: p.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 10, paddingHorizontal: 20, gap: 14 },
  grab: { gap: 14, backgroundColor: p.surface },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: p.border, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
}));
