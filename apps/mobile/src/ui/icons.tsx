/**
 * Tabler icons, imported one file each so the bundle only carries what we use.
 * Outline at 1.75 stroke everywhere (design.md); filled variants only for player controls.
 */
import type { Lane } from '@fit/core';
import type { QuickLogType } from '@fit/core';
import IconArrowsExchange from '@tabler/icons-react-native/IconArrowsExchange';
import IconBarbell from '@tabler/icons-react-native/IconBarbell';
import IconBell from '@tabler/icons-react-native/IconBell';
import IconBike from '@tabler/icons-react-native/IconBike';
import IconCalendar from '@tabler/icons-react-native/IconCalendar';
import IconCalendarEvent from '@tabler/icons-react-native/IconCalendarEvent';
import IconChartBar from '@tabler/icons-react-native/IconChartBar';
import IconCheck from '@tabler/icons-react-native/IconCheck';
import IconChevronLeft from '@tabler/icons-react-native/IconChevronLeft';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconClock from '@tabler/icons-react-native/IconClock';
import IconDots from '@tabler/icons-react-native/IconDots';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import IconListDetails from '@tabler/icons-react-native/IconListDetails';
import IconMountain from '@tabler/icons-react-native/IconMountain';
import IconPlus from '@tabler/icons-react-native/IconPlus';
import IconRun from '@tabler/icons-react-native/IconRun';
import IconSettings from '@tabler/icons-react-native/IconSettings';
import IconStretching from '@tabler/icons-react-native/IconStretching';
import IconSun from '@tabler/icons-react-native/IconSun';
import IconSwimming from '@tabler/icons-react-native/IconSwimming';
import IconTrash from '@tabler/icons-react-native/IconTrash';
import IconWalk from '@tabler/icons-react-native/IconWalk';
import IconX from '@tabler/icons-react-native/IconX';
import type { ComponentType } from 'react';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

type TablerIcon = ComponentType<IconProps>;

function wrap(Icon: TablerIcon): TablerIcon {
  function Wrapped({ size = 20, color, strokeWidth = 1.75 }: IconProps) {
    return <Icon size={size} color={color} strokeWidth={strokeWidth} />;
  }
  return Wrapped;
}

export const Icons = {
  sun: wrap(IconSun),
  calendar: wrap(IconCalendar),
  calendarEvent: wrap(IconCalendarEvent),
  listDetails: wrap(IconListDetails),
  chartBar: wrap(IconChartBar),
  settings: wrap(IconSettings),
  run: wrap(IconRun),
  barbell: wrap(IconBarbell),
  stretching: wrap(IconStretching),
  plus: wrap(IconPlus),
  x: wrap(IconX),
  check: wrap(IconCheck),
  chevronLeft: wrap(IconChevronLeft),
  chevronRight: wrap(IconChevronRight),
  clock: wrap(IconClock),
  dots: wrap(IconDots),
  info: wrap(IconInfoCircle),
  swap: wrap(IconArrowsExchange),
  bell: wrap(IconBell),
  trash: wrap(IconTrash),
  walk: wrap(IconWalk),
  mountain: wrap(IconMountain),
  bike: wrap(IconBike),
  swimming: wrap(IconSwimming),
} as const;

export const LANE_ICON: Record<Lane, TablerIcon> = {
  run: Icons.run,
  workout: Icons.barbell,
  stretch: Icons.stretching,
};

export const QUICK_LOG_ICON: Record<QuickLogType, TablerIcon> = {
  walk: Icons.walk,
  hike: Icons.mountain,
  bike: Icons.bike,
  swim: Icons.swimming,
  run: Icons.run,
  lift: Icons.barbell,
  stretch: Icons.stretching,
  other: Icons.dots,
};
