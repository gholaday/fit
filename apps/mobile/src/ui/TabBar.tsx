import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles, usePalette } from '@/theme';
import { Icons } from './icons';
import { T } from './primitives';
import { haptic } from '@/lib/haptics';

const ICONS = {
  index: Icons.sun,
  plan: Icons.calendar,
  library: Icons.listDetails,
  stats: Icons.chartBar,
} as const;

/** Bottom tabs as in the mockups: icon over label, hairline on top. */
export function TabBar({ state, descriptors, navigateToTab }: BottomTabBarProps) {
  const s = useStyles();
  // Clear Android's navigation bar or gesture handle, plus breathing room above it.
  const insets = useSafeAreaInsets();
  const p = usePalette();
  return (
    <View style={[s.bar, { paddingBottom: insets.bottom + 10 }]} accessibilityRole="tablist">
      {state.routes.map((route, i) => {
        const on = state.index === i;
        const color = on ? p.text : p.textTertiary;
        const Icon = ICONS[route.name as keyof typeof ICONS] ?? Icons.sun;
        const title = descriptors[route.key]?.options.title ?? route.name;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={title}
            onPress={() => {
              if (!on) haptic.tick();
              navigateToTab(route.key);
            }}
            style={s.item}
          >
            <Icon size={22} color={color} />
            <T v="micro" color={color}>
              {title}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((p) => ({
  bar: { flexDirection: 'row', paddingTop: 10, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: p.ringTrack, backgroundColor: p.bg },
  item: { flex: 1, alignItems: 'center', gap: 4, minHeight: 44 },
}));
