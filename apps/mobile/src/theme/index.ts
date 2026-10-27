import { type ImageStyle, StyleSheet, type TextStyle, useColorScheme, type ViewStyle } from 'react-native';
import { useFit } from '@/data/store';
import { dark, light, type Palette } from './tokens';

export * from './tokens';

/** Light or dark from the Appearance setting; System follows the phone. */
export function usePalette(): Palette {
  const system = useColorScheme();
  const appearance = useFit((s) => s.settings.appearance);
  return (appearance === 'system' ? system : appearance) === 'dark' ? dark : light;
}

type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * Themed StyleSheet: built once per scheme and cached, so components pay nothing per
 * render beyond a scheme lookup.
 */
export function createStyles<S extends Styles>(build: (p: Palette) => S & Styles): () => Readonly<S> {
  let lightStyles: Readonly<S> | undefined;
  let darkStyles: Readonly<S> | undefined;
  return function useStyles() {
    const p = usePalette();
    if (p.scheme === 'dark') return (darkStyles ??= StyleSheet.create(build(dark)));
    return (lightStyles ??= StyleSheet.create(build(light)));
  };
}
