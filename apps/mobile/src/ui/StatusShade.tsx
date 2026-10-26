import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePalette } from '@/theme';

/**
 * Opaque strip behind the status bar for screens whose content scrolls under it (the bar
 * is translucent edge to edge). Render it after the scroll view so it sits on top.
 */
export function StatusShade() {
  const top = useSafeAreaInsets().top;
  const p = usePalette();
  return <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: top, backgroundColor: p.bg }} />;
}
