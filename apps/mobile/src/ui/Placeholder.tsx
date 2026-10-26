import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme';
import { T } from './primitives';

export function Placeholder({ title, body }: { title: string; body: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 12 }}>
      <T v="display" accessibilityRole="header">
        {title}
      </T>
      <View style={{ backgroundColor: p.surface, borderRadius: 16, padding: 16 }}>
        <T v="body" tone="secondary">
          {body}
        </T>
      </View>
    </View>
  );
}
