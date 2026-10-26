/**
 * Phosphor icons, imported one file each so the bundle only carries what we use (the
 * package index is over 500 KB). Regular weight for UI chrome; activity glyphs and player
 * controls are filled (design.md).
 */
import type { Lane, QuickLogType } from '@fit/core';
import { ArrowsLeftRightIcon } from 'phosphor-react-native/src/icons/ArrowsLeftRight';
import { BarbellIcon } from 'phosphor-react-native/src/icons/Barbell';
import { BatteryFullIcon } from 'phosphor-react-native/src/icons/BatteryFull';
import { BellIcon } from 'phosphor-react-native/src/icons/Bell';
import { CalendarBlankIcon } from 'phosphor-react-native/src/icons/CalendarBlank';
import { CalendarCheckIcon } from 'phosphor-react-native/src/icons/CalendarCheck';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { CaretLeftIcon } from 'phosphor-react-native/src/icons/CaretLeft';
import { CaretRightIcon } from 'phosphor-react-native/src/icons/CaretRight';
import { CaretUpIcon } from 'phosphor-react-native/src/icons/CaretUp';
import { CellSignalFullIcon } from 'phosphor-react-native/src/icons/CellSignalFull';
import { ChartBarIcon } from 'phosphor-react-native/src/icons/ChartBar';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { ClockIcon } from 'phosphor-react-native/src/icons/Clock';
import { CrosshairIcon } from 'phosphor-react-native/src/icons/Crosshair';
import { DotsThreeIcon } from 'phosphor-react-native/src/icons/DotsThree';
import { FlagIcon } from 'phosphor-react-native/src/icons/Flag';
import { GearSixIcon } from 'phosphor-react-native/src/icons/GearSix';
import { HeartIcon } from 'phosphor-react-native/src/icons/Heart';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { ListBulletsIcon } from 'phosphor-react-native/src/icons/ListBullets';
import { LockIcon } from 'phosphor-react-native/src/icons/Lock';
import { LockOpenIcon } from 'phosphor-react-native/src/icons/LockOpen';
import { MapTrifoldIcon } from 'phosphor-react-native/src/icons/MapTrifold';
import { MountainsIcon } from 'phosphor-react-native/src/icons/Mountains';
import { PathIcon } from 'phosphor-react-native/src/icons/Path';
import { PauseIcon } from 'phosphor-react-native/src/icons/Pause';
import { PersonSimpleBikeIcon } from 'phosphor-react-native/src/icons/PersonSimpleBike';
import { PersonSimpleRunIcon } from 'phosphor-react-native/src/icons/PersonSimpleRun';
import { PersonSimpleSwimIcon } from 'phosphor-react-native/src/icons/PersonSimpleSwim';
import { PersonSimpleTaiChiIcon } from 'phosphor-react-native/src/icons/PersonSimpleTaiChi';
import { PersonSimpleWalkIcon } from 'phosphor-react-native/src/icons/PersonSimpleWalk';
import { PlayIcon } from 'phosphor-react-native/src/icons/Play';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { SkipBackIcon } from 'phosphor-react-native/src/icons/SkipBack';
import { SkipForwardIcon } from 'phosphor-react-native/src/icons/SkipForward';
import { SpeakerHighIcon } from 'phosphor-react-native/src/icons/SpeakerHigh';
import { SpeakerSlashIcon } from 'phosphor-react-native/src/icons/SpeakerSlash';
import { StopIcon } from 'phosphor-react-native/src/icons/Stop';
import { SunIcon } from 'phosphor-react-native/src/icons/Sun';
import { TrashIcon } from 'phosphor-react-native/src/icons/Trash';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import type { Icon as PhosphorIcon } from 'phosphor-react-native';
import type { ComponentType } from 'react';

export type IconWeight = 'regular' | 'bold' | 'fill';

export interface IconProps {
  size?: number;
  color?: string;
  /** Overrides the icon's default weight. */
  weight?: IconWeight;
}

export type AppIcon = ComponentType<IconProps>;

function wrap(Icon: PhosphorIcon, base: IconWeight = 'regular'): AppIcon {
  function Wrapped({ size = 20, color, weight = base }: IconProps) {
    return <Icon size={size} color={color} weight={weight} />;
  }
  return Wrapped;
}

export const Icons = {
  sun: wrap(SunIcon),
  calendar: wrap(CalendarBlankIcon),
  calendarEvent: wrap(CalendarCheckIcon),
  listDetails: wrap(ListBulletsIcon),
  chartBar: wrap(ChartBarIcon),
  settings: wrap(GearSixIcon),
  plus: wrap(PlusIcon),
  x: wrap(XIcon),
  check: wrap(CheckIcon),
  chevronLeft: wrap(CaretLeftIcon),
  chevronRight: wrap(CaretRightIcon),
  chevronUp: wrap(CaretUpIcon),
  chevronDown: wrap(CaretDownIcon),
  clock: wrap(ClockIcon),
  dots: wrap(DotsThreeIcon),
  info: wrap(InfoIcon),
  swap: wrap(ArrowsLeftRightIcon),
  bell: wrap(BellIcon),
  trash: wrap(TrashIcon),
  lock: wrap(LockIcon),
  lockOpen: wrap(LockOpenIcon),
  map: wrap(MapTrifoldIcon),
  route: wrap(PathIcon),
  flag: wrap(FlagIcon),
  heart: wrap(HeartIcon),
  volume: wrap(SpeakerHighIcon),
  volumeOff: wrap(SpeakerSlashIcon),
  signal: wrap(CellSignalFullIcon),
  location: wrap(CrosshairIcon),
  battery: wrap(BatteryFullIcon),
  // Activities: filled glyphs, drawn in the lane color on its tint.
  run: wrap(PersonSimpleRunIcon, 'fill'),
  barbell: wrap(BarbellIcon, 'fill'),
  stretching: wrap(PersonSimpleTaiChiIcon, 'fill'),
  walk: wrap(PersonSimpleWalkIcon, 'fill'),
  mountain: wrap(MountainsIcon, 'fill'),
  bike: wrap(PersonSimpleBikeIcon, 'fill'),
  swimming: wrap(PersonSimpleSwimIcon, 'fill'),
  // Player controls.
  pause: wrap(PauseIcon, 'fill'),
  play: wrap(PlayIcon, 'fill'),
  previous: wrap(SkipBackIcon, 'fill'),
  skip: wrap(SkipForwardIcon, 'fill'),
  stop: wrap(StopIcon, 'fill'),
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
