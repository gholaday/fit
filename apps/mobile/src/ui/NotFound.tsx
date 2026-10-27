import { router } from 'expo-router';
import { View } from 'react-native';
import { usePalette } from '@/theme';
import { Icons } from './icons';
import { IconButton, T } from './primitives';

/** Full screen for a record that is gone (deleted, or an old link), with a way back. */
export function NotFound({ message }: { message: string }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <T v="bodyMedium" tone="secondary">
        {message}
      </T>
      <IconButton label="Close" size={44} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
        <Icons.x size={20} color={p.text} />
      </IconButton>
    </View>
  );
}
