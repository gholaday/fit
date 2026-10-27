/**
 * Midnight tokens from docs/design.md. Light is the primary reference; dark values come
 * from docs/mockups/dark. Pace/hard (amber) and sprint (clay) dark values are defined
 * here following the same rule as the other activity colors: the color lifts in
 * lightness, the tint is the color at low opacity over the dark surface.
 */
import type { ExternalActivity, Lane, QuickLogType, StructureTone } from '@fit/core';

export interface ActivityColor {
  /** Icons, filled strip segments, progress fills. */
  color: string;
  /** Tile and chip background. */
  tint: string;
  /** Text placed on the tint. */
  onTint: string;
  /** Not-yet-done segment in the day widget strip. */
  pending: string;
}

export interface Palette {
  scheme: 'light' | 'dark';
  bg: string;
  surface: string;
  inset: string;
  segmentTrack: string;
  segmentActive: string;
  border: string;
  outline: string;
  divider: string;
  dashed: string;
  text: string;
  textBody: string;
  textSecondary: string;
  textTertiary: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  ringTrack: string;
  doneRow: string;
  dayDone: string;
  scrim: string;
  run: ActivityColor;
  strength: ActivityColor;
  stretch: ActivityColor;
  hard: ActivityColor;
  sprint: ActivityColor;
  walk: string;
  success: string;
  /** Light blue for the steps bar and chart, lighter than the run blue. */
  steps: string;
  /** Muted teal for the weight trend and goal progress. */
  weight: string;
  /** Gold for record trophies, the one saturated accent. */
  trophy: string;
}

export const light: Palette = {
  scheme: 'light',
  bg: '#F7F7F8',
  surface: '#FFFFFF',
  inset: '#F2F2F4',
  segmentTrack: '#FFFFFF',
  segmentActive: '#EBEBEE',
  border: '#DCDCE0',
  outline: '#E3E3E7',
  divider: '#EDEDF0',
  dashed: '#C9C9CF',
  text: '#141518',
  textBody: '#3A3B42',
  textSecondary: '#62636B',
  textTertiary: '#6B6C74',
  textMuted: '#8C8D95',
  primary: '#141518',
  onPrimary: '#F7F7F8',
  ringTrack: '#E6E6EA',
  doneRow: '#EFEFF1',
  dayDone: '#E8E8EB',
  scrim: 'rgba(20,21,24,0.32)',
  run: { color: '#4F8DB0', tint: '#E1ECF2', onTint: '#2F6A8C', pending: '#D7E6EF' },
  strength: { color: '#8C83C0', tint: '#ECEAF5', onTint: '#5E5596', pending: '#E2DFF0' },
  stretch: { color: '#5F9370', tint: '#E3EEE5', onTint: '#3F6E4C', pending: '#DCEADF' },
  hard: { color: '#C9A273', tint: '#F3EADF', onTint: '#7A5530', pending: '#EDE1D1' },
  sprint: { color: '#B97A5B', tint: '#F5E4DC', onTint: '#7E4630', pending: '#EED8CD' },
  walk: '#C9CACF',
  success: '#5F9370',
  steps: '#7DB9E3',
  weight: '#5E9C9E',
  trophy: '#E0A800',
};

export const dark: Palette = {
  scheme: 'dark',
  bg: '#111214',
  surface: '#1A1B1F',
  inset: '#232429',
  segmentTrack: '#1A1B1F',
  segmentActive: '#2C2D33',
  border: '#2E2F35',
  outline: '#2E2F35',
  divider: '#1D1E22',
  dashed: '#34353C',
  text: '#ECECEE',
  textBody: '#C9CAD0',
  textSecondary: '#9C9DA5',
  textTertiary: '#7C7D85',
  textMuted: '#5E5F67',
  primary: '#ECECEE',
  onPrimary: '#111214',
  ringTrack: '#26272D',
  doneRow: '#17181B',
  dayDone: '#232429',
  scrim: 'rgba(0,0,0,0.5)',
  run: { color: '#6FA8C7', tint: '#1C2730', onTint: '#A9CDE0', pending: '#22303A' },
  strength: { color: '#9C93C9', tint: '#24222F', onTint: '#C3BDE3', pending: '#2A2836' },
  stretch: { color: '#8DB596', tint: '#1F2A22', onTint: '#B5D2BB', pending: '#24302A' },
  // Defined here (design.md said "to define").
  hard: { color: '#D6B48C', tint: '#2D261E', onTint: '#E6CDAA', pending: '#352C22' },
  sprint: { color: '#CC9479', tint: '#2E221D', onTint: '#E7BCA7', pending: '#382821' },
  walk: '#4B4E57',
  success: '#8DB596',
  steps: '#8FC6EC',
  weight: '#86BFC1',
  trophy: '#F2C230',
};

export function laneColor(p: Palette, lane: Lane): ActivityColor {
  return lane === 'run' ? p.run : lane === 'workout' ? p.strength : p.stretch;
}

/** Quick log, watch and history types: a run, a quick log or a watch activity. */
export type ActivityType = QuickLogType | ExternalActivity;

/** Other activity types reuse the five families, icon and tint alike (design.md, Other activity types). */
export function activityColor(p: Palette, type: ActivityType): ActivityColor {
  switch (type) {
    case 'run':
    case 'treadmill':
    case 'swim':
      return p.run;
    case 'hike':
    case 'stretch':
      return p.stretch;
    case 'lift':
    case 'strength':
      return p.strength;
    case 'bike':
      return p.hard;
    case 'walk':
    case 'other':
      // p.walk is a bar color, too pale for an icon on a tile.
      return { color: p.textMuted, tint: p.inset, onTint: p.textSecondary, pending: p.walk };
  }
}

export function toneColor(p: Palette, tone: StructureTone): string {
  switch (tone) {
    case 'easy':
      return p.run.color;
    case 'hard':
      return p.hard.color;
    case 'sprint':
      return p.sprint.color;
    case 'walk':
      return p.walk;
  }
}

export const radius = { card: 20, cardSm: 16, row: 14, button: 14, buttonSm: 12, tile: 10, pill: 999 } as const;
export const space = { gutter: 20, gap: 12 } as const;
export const motion = { fast: 150, base: 200, slow: 250 } as const;
