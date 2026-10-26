/**
 * Tabler icons, imported one file each so the bundle only carries what we use.
 * Outline at 1.75 stroke everywhere (design.md); filled variants only for player controls.
 */
import type { Lane } from '@fit/core';
import type { QuickLogType } from '@fit/core';
import IconAntennaBars5 from '@tabler/icons-react-native/IconAntennaBars5';
import IconArrowsExchange from '@tabler/icons-react-native/IconArrowsExchange';
import IconBarbell from '@tabler/icons-react-native/IconBarbell';
import IconBattery from '@tabler/icons-react-native/IconBattery';
import IconBell from '@tabler/icons-react-native/IconBell';
import IconBike from '@tabler/icons-react-native/IconBike';
import IconCalendar from '@tabler/icons-react-native/IconCalendar';
import IconCalendarEvent from '@tabler/icons-react-native/IconCalendarEvent';
import IconChartBar from '@tabler/icons-react-native/IconChartBar';
import IconCheck from '@tabler/icons-react-native/IconCheck';
import IconChevronDown from '@tabler/icons-react-native/IconChevronDown';
import IconChevronLeft from '@tabler/icons-react-native/IconChevronLeft';
import IconChevronRight from '@tabler/icons-react-native/IconChevronRight';
import IconChevronUp from '@tabler/icons-react-native/IconChevronUp';
import IconClock from '@tabler/icons-react-native/IconClock';
import IconCurrentLocation from '@tabler/icons-react-native/IconCurrentLocation';
import IconDots from '@tabler/icons-react-native/IconDots';
import IconFlag from '@tabler/icons-react-native/IconFlag';
import IconHeart from '@tabler/icons-react-native/IconHeart';
import IconInfoCircle from '@tabler/icons-react-native/IconInfoCircle';
import IconListDetails from '@tabler/icons-react-native/IconListDetails';
import IconLock from '@tabler/icons-react-native/IconLock';
import IconLockOpen from '@tabler/icons-react-native/IconLockOpen';
import IconMap from '@tabler/icons-react-native/IconMap';
import IconMountain from '@tabler/icons-react-native/IconMountain';
import IconPlayerPauseFilled from '@tabler/icons-react-native/IconPlayerPauseFilled';
import IconPlayerPlayFilled from '@tabler/icons-react-native/IconPlayerPlayFilled';
import IconPlayerSkipBackFilled from '@tabler/icons-react-native/IconPlayerSkipBackFilled';
import IconPlayerSkipForwardFilled from '@tabler/icons-react-native/IconPlayerSkipForwardFilled';
import IconPlayerStopFilled from '@tabler/icons-react-native/IconPlayerStopFilled';
import IconPlus from '@tabler/icons-react-native/IconPlus';
import IconRoute from '@tabler/icons-react-native/IconRoute';
import IconRun from '@tabler/icons-react-native/IconRun';
import IconSettings from '@tabler/icons-react-native/IconSettings';
import IconStretching from '@tabler/icons-react-native/IconStretching';
import IconSun from '@tabler/icons-react-native/IconSun';
import IconSwimming from '@tabler/icons-react-native/IconSwimming';
import IconTrash from '@tabler/icons-react-native/IconTrash';
import IconVolume from '@tabler/icons-react-native/IconVolume';
import IconVolumeOff from '@tabler/icons-react-native/IconVolumeOff';
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
  chevronUp: wrap(IconChevronUp),
  chevronDown: wrap(IconChevronDown),
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
  lock: wrap(IconLock),
  lockOpen: wrap(IconLockOpen),
  map: wrap(IconMap),
  route: wrap(IconRoute),
  flag: wrap(IconFlag),
  heart: wrap(IconHeart),
  volume: wrap(IconVolume),
  volumeOff: wrap(IconVolumeOff),
  signal: wrap(IconAntennaBars5),
  location: wrap(IconCurrentLocation),
  battery: wrap(IconBattery),
  pause: wrap(IconPlayerPauseFilled),
  play: wrap(IconPlayerPlayFilled),
  previous: wrap(IconPlayerSkipBackFilled),
  skip: wrap(IconPlayerSkipForwardFilled),
  stop: wrap(IconPlayerStopFilled),
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
