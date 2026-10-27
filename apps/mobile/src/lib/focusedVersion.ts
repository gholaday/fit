import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useDataVersion } from '@/data/store';

/**
 * The data version, held while the screen is out of focus (a tab in the background, a
 * screen under another). Screens that do a large read per version use this so writes made
 * elsewhere are picked up once, when they are shown again, not on every write.
 */
export function useFocusedDataVersion(): number {
  const live = useDataVersion();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [version, setVersion] = useState(live);
  if (focused && version !== live) setVersion(live);
  return version;
}
