/**
 * Icons in murmur's style: Lucide drawings (ISC license, lucide.dev) on a 24 grid,
 * 2 px round strokes, drawn here with react-native-svg so there is no icon package.
 * Screens import icons only from this file. Player controls are filled.
 */
import type { Lane, QuickLogType } from '@fit/core';
import { type ComponentType, memo, type ReactNode } from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

export type AppIcon = ComponentType<IconProps>;

function icon(filled: boolean, shapes: ReactNode): AppIcon {
  return memo(function Icon({ size = 20, color = '#000', strokeWidth = 2 }: IconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        {shapes}
      </Svg>
    );
  });
}

export const Icons = {
  sun: icon(false, <><Circle cx="12" cy="12" r="4" /><Path d="M12 2v2" /><Path d="M12 20v2" /><Path d="m4.93 4.93 1.41 1.41" /><Path d="m17.66 17.66 1.41 1.41" /><Path d="M2 12h2" /><Path d="M20 12h2" /><Path d="m6.34 17.66-1.41 1.41" /><Path d="m19.07 4.93-1.41 1.41" /></>),
  calendar: icon(false, <><Path d="M8 2v4" /><Path d="M16 2v4" /><Rect width="18" height="18" x="3" y="4" rx="2" /><Path d="M3 10h18" /></>),
  calendarEvent: icon(false, <><Path d="M8 2v4" /><Path d="M16 2v4" /><Rect width="18" height="18" x="3" y="4" rx="2" /><Path d="M3 10h18" /><Path d="m9 16 2 2 4-4" /></>),
  listDetails: icon(false, <><Path d="M3 5h.01" /><Path d="M3 12h.01" /><Path d="M3 19h.01" /><Path d="M8 5h13" /><Path d="M8 12h13" /><Path d="M8 19h13" /></>),
  chartBar: icon(false, <><Path d="M3 3v16a2 2 0 0 0 2 2h16" /><Path d="M18 17V9" /><Path d="M13 17V5" /><Path d="M8 17v-3" /></>),
  settings: icon(false, <><Path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><Circle cx="12" cy="12" r="3" /></>),
  plus: icon(false, <><Path d="M5 12h14" /><Path d="M12 5v14" /></>),
  x: icon(false, <><Path d="M18 6 6 18" /><Path d="m6 6 12 12" /></>),
  check: icon(false, <><Path d="M20 6 9 17l-5-5" /></>),
  chevronLeft: icon(false, <><Path d="m15 18-6-6 6-6" /></>),
  chevronRight: icon(false, <><Path d="m9 18 6-6-6-6" /></>),
  chevronUp: icon(false, <><Path d="m18 15-6-6-6 6" /></>),
  chevronDown: icon(false, <><Path d="m6 9 6 6 6-6" /></>),
  clock: icon(false, <><Path d="M12 6v6l4 2" /><Circle cx="12" cy="12" r="10" /></>),
  dots: icon(false, <><Circle cx="12" cy="12" r="1" /><Circle cx="19" cy="12" r="1" /><Circle cx="5" cy="12" r="1" /></>),
  info: icon(false, <><Circle cx="12" cy="12" r="10" /><Path d="M12 16v-4" /><Path d="M12 8h.01" /></>),
  backspace: icon(false, <><Path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z" /><Path d="m12 9 6 6" /><Path d="m18 9-6 6" /></>),
  swap: icon(false, <><Path d="M8 3 4 7l4 4" /><Path d="M4 7h16" /><Path d="m16 21 4-4-4-4" /><Path d="M20 17H4" /></>),
  bell: icon(false, <><Path d="M10.268 21a2 2 0 0 0 3.464 0" /><Path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>),
  trash: icon(false, <><Path d="M10 11v6" /><Path d="M14 11v6" /><Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><Path d="M3 6h18" /><Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>),
  lock: icon(false, <><Rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><Path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  lockOpen: icon(false, <><Rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><Path d="M7 11V7a5 5 0 0 1 9.9-1" /></>),
  map: icon(false, <><Path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z" /><Path d="M15 5.764v15" /><Path d="M9 3.236v15" /></>),
  route: icon(false, <><Circle cx="6" cy="19" r="3" /><Path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><Circle cx="18" cy="5" r="3" /></>),
  flag: icon(false, <><Path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" /></>),
  heart: icon(false, <><Path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /></>),
  volume: icon(false, <><Path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><Path d="M16 9a5 5 0 0 1 0 6" /><Path d="M19.364 18.364a9 9 0 0 0 0-12.728" /></>),
  volumeOff: icon(false, <><Path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" /><Line  /><Line  /></>),
  signal: icon(false, <><Path d="M2 20h.01" /><Path d="M7 20v-4" /><Path d="M12 20v-8" /><Path d="M17 20V8" /><Path d="M22 4v16" /></>),
  location: icon(false, <><Line  /><Line  /><Line  /><Line  /><Circle cx="12" cy="12" r="7" /><Circle cx="12" cy="12" r="3" /></>),
  battery: icon(false, <><Path d="M10 10v4" /><Path d="M14 10v4" /><Path d="M22 14v-4" /><Path d="M6 10v4" /><Rect x="2" y="6" width="16" height="12" rx="2" /></>),
  // Activities.
  run: icon(false, <><Path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" /><Path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" /><Path d="M16 17h4" /><Path d="M4 13h4" /></>),
  barbell: icon(false, <><Path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1" /><Path d="M15 14a5 5 0 0 0-7.584 2" /><Path d="M9.964 6.825C8.019 7.977 9.5 13 8 15" /></>),
  stretching: icon(false, <><Circle cx="12" cy="5" r="1" /><Path d="m9 20 3-6 3 6" /><Path d="m6 8 6 2 6-2" /><Path d="M12 10v4" /></>),
  walk: icon(false, <><Path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z" /><Path d="M12 22v-3" /></>),
  mountain: icon(false, <><Path d="m8 3 4 8 5-5 5 15H2L8 3z" /></>),
  bike: icon(false, <><Circle cx="18.5" cy="17.5" r="3.5" /><Circle cx="5.5" cy="17.5" r="3.5" /><Circle cx="15" cy="5" r="1" /><Path d="M12 17.5V14l-3-3 4-3 2 3h2" /></>),
  swimming: icon(false, <><Path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><Path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><Path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /></>),
  // Player controls.
  pause: icon(true, <><Rect x="14" y="3" width="5" height="18" rx="1" /><Rect x="5" y="3" width="5" height="18" rx="1" /></>),
  play: icon(true, <><Path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" /></>),
  previous: icon(true, <><Path d="M17.971 4.285A2 2 0 0 1 21 6v12a2 2 0 0 1-3.029 1.715l-9.997-5.998a2 2 0 0 1-.003-3.432z" /><Path d="M3 20V4" /></>),
  skip: icon(true, <><Path d="M21 4v16" /><Path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" /></>),
  stop: icon(true, <><Rect width="18" height="18" x="3" y="3" rx="2" /></>),
} as const;

export const LANE_ICON: Record<Lane, AppIcon> = {
  run: Icons.run,
  workout: Icons.barbell,
  stretch: Icons.stretching,
};

export const QUICK_LOG_ICON: Record<QuickLogType, AppIcon> = {
  walk: Icons.walk,
  hike: Icons.mountain,
  bike: Icons.bike,
  swim: Icons.swimming,
  run: Icons.run,
  lift: Icons.barbell,
  stretch: Icons.stretching,
  other: Icons.dots,
};
