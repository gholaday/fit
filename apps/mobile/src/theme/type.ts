import type { TextStyle } from 'react-native';

/**
 * Inter is embedded at build time by the expo-font plugin (app.json) as one family with
 * four weights, so fontWeight selects the face and nothing loads at runtime.
 */
export const FONT = 'Inter';

type Weight = '400' | '500' | '600' | '700';

function face(size: number, weight: Weight, extra?: TextStyle): TextStyle {
  return { fontFamily: FONT, fontSize: size, fontWeight: weight, ...extra };
}

const tight = { letterSpacing: -0.4 };

export const type = {
  display: face(28, '700', { ...tight, lineHeight: 34 }),
  title: face(22, '700', { ...tight, lineHeight: 28 }),
  heading: face(20, '700', { lineHeight: 26 }),
  sheetTitle: face(18, '700', { lineHeight: 24 }),
  headline: face(16, '600', { lineHeight: 21 }),
  bodyStrong: face(15, '600', { lineHeight: 20 }),
  bodyMedium: face(15, '500', { lineHeight: 20 }),
  body: face(15, '400', { lineHeight: 20 }),
  label: face(13, '500', { lineHeight: 18 }),
  labelStrong: face(13, '600', { lineHeight: 18 }),
  caption: face(12, '400', { lineHeight: 16 }),
  captionMedium: face(12, '500', { lineHeight: 16 }),
  captionStrong: face(12, '600', { lineHeight: 16 }),
  micro: face(11, '500', { lineHeight: 14 }),
  tiny: face(10, '500', { lineHeight: 13 }),
  /** Numbers: tabular figures so values do not jitter. */
  stat: face(20, '600', { fontVariant: ['tabular-nums'], lineHeight: 26 }),
  statSm: face(17, '600', { fontVariant: ['tabular-nums'], lineHeight: 22 }),
  num: { fontVariant: ['tabular-nums'] } as TextStyle,
} satisfies Record<string, TextStyle>;
