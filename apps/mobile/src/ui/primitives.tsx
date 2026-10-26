import type { Lane, StructureSegment } from '@fit/core';
import { memo, type ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, Text, type TextProps, type TextStyle, View, type ViewStyle } from 'react-native';
import { createStyles, laneColor, toneColor, usePalette } from '@/theme';
import { type } from '@/theme/type';
import { LANE_ICON } from './icons';
import { haptic } from '@/lib/haptics';

type Variant = keyof typeof type;
type Tone = 'text' | 'body' | 'secondary' | 'tertiary' | 'muted' | 'onPrimary';

export interface TProps extends TextProps {
  v?: Variant;
  tone?: Tone;
  color?: string;
  num?: boolean;
  align?: TextStyle['textAlign'];
}

/** Text with a type ramp variant and a palette tone. */
export function T({ v = 'body', tone = 'text', color, num, align, style, ...rest }: TProps) {
  const p = usePalette();
  const toneColor =
    color ??
    { text: p.text, body: p.textBody, secondary: p.textSecondary, tertiary: p.textTertiary, muted: p.textMuted, onPrimary: p.onPrimary }[tone];
  return <Text {...rest} allowFontScaling style={[type[v], { color: toneColor }, num && type.num, align && { textAlign: align }, style]} />;
}

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  kind?: 'primary' | 'outline' | 'quiet';
  size?: 'lg' | 'md' | 'sm';
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Button({ label, kind = 'primary', size = 'lg', icon, style, disabled, ...rest }: ButtonProps) {
  const s = useButtonStyles();
  const p = usePalette();
  const fg = kind === 'primary' ? p.onPrimary : p.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={size === 'sm' ? 6 : 0}
      style={({ pressed }) => [s.base, s[size], s[kind], (pressed || disabled) && { opacity: disabled ? 0.4 : 0.7 }, style]}
      {...rest}
    >
      {icon}
      <T v={size === 'sm' ? 'label' : kind === 'primary' ? 'bodyStrong' : 'bodyMedium'} color={fg}>
        {label}
      </T>
    </Pressable>
  );
}

const useButtonStyles = createStyles((p) => ({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  lg: { height: 52, borderRadius: 14, paddingHorizontal: 18 },
  md: { height: 48, borderRadius: 14, paddingHorizontal: 16 },
  sm: { height: 36, borderRadius: 12, paddingHorizontal: 14 },
  primary: { backgroundColor: p.primary },
  outline: { borderWidth: 1, borderColor: p.border, backgroundColor: 'transparent' },
  quiet: { backgroundColor: p.inset },
}));

interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  children: ReactNode;
  size?: number;
  bg?: 'surface' | 'inset' | 'none';
  style?: StyleProp<ViewStyle>;
}

export function IconButton({ label, children, size = 36, bg = 'surface', style, ...rest }: IconButtonProps) {
  const p = usePalette();
  const backgroundColor = bg === 'surface' ? p.surface : bg === 'inset' ? p.inset : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Math.max(0, (44 - size) / 2)}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 }, style]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

/** Tinted square with the lane icon (run, barbell, stretching). */
export const LaneTile = memo(function LaneTile({ lane, size = 36, faded }: { lane: Lane; size?: number; faded?: boolean }) {
  const p = usePalette();
  const c = laneColor(p, lane);
  const Icon = LANE_ICON[lane];
  return (
    <View style={{ width: size, height: size, borderRadius: size > 38 ? 11 : 10, backgroundColor: c.tint, alignItems: 'center', justifyContent: 'center', opacity: faded ? 0.7 : 1 }}>
      <Icon size={size > 38 ? 22 : 20} color={c.color} />
    </View>
  );
});

/** The signature structure bar: proportional colored segments. */
export const StructureBar = memo(function StructureBar({ segments, height = 8 }: { segments: readonly StructureSegment[]; height?: number }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 3, height }}>
      {segments.map((seg, i) => (
        <View key={i} style={{ flex: seg.fraction, borderRadius: height / 2, backgroundColor: toneColor(p, seg.tone) }} />
      ))}
    </View>
  );
});

interface SegmentedProps<V extends string> {
  options: readonly { value: V; label: string; disabled?: boolean }[];
  value: V;
  onChange: (v: V) => void;
  /** "card": white track with grey active (Plan tabs). "inset": grey track with white active (forms). */
  look?: 'card' | 'inset';
}

export function Segmented<V extends string>({ options, value, onChange, look = 'card' }: SegmentedProps<V>) {
  const p = usePalette();
  const track = look === 'card' ? p.segmentTrack : p.scheme === 'dark' ? p.surface : p.segmentActive;
  const active = look === 'card' ? p.segmentActive : p.scheme === 'dark' ? p.segmentActive : p.surface;
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: track, borderRadius: 12, padding: 4 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on, disabled: o.disabled }}
            disabled={o.disabled}
            onPress={() => {
              if (!on) haptic.tick();
              onChange(o.value);
            }}
            style={{ flex: 1, height: 36, borderRadius: 9, backgroundColor: on ? active : 'transparent', alignItems: 'center', justifyContent: 'center', opacity: o.disabled ? 0.4 : 1 }}
          >
            <T v={on ? 'labelStrong' : 'label'} tone={on ? 'text' : 'secondary'}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Rounded group of rows with dividers (forms, settings). */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ backgroundColor: p.surface, borderRadius: 16, overflow: 'hidden' }, style]}>{children}</View>;
}

export function Row({ label, sub, children, last, onPress }: { label: string; sub?: string; children?: ReactNode; last?: boolean; onPress?: () => void }) {
  const p = usePalette();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: p.divider }}>
      <View style={{ flexShrink: 1 }}>
        <T v="bodyMedium">{label}</T>
        {sub ? <T v="caption" tone="secondary">{sub}</T> : null}
      </View>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}

/** "- value +" stepper used for durations, HR and times. */
export function Stepper({ value, onMinus, onPlus, minusLabel, plusLabel, width = 82 }: { value: string; onMinus: () => void; onPlus: () => void; minusLabel: string; plusLabel: string; width?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <StepButton label={minusLabel} glyph="-" onPress={onMinus} />
      <T v="bodyStrong" num align="center" style={{ minWidth: width }}>
        {value}
      </T>
      <StepButton label={plusLabel} glyph="+" onPress={onPlus} />
    </View>
  );
}

function StepButton({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic.tick();
        onPress();
      }}
      hitSlop={5}
      style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 10, backgroundColor: p.inset, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <T v="headline" style={{ fontSize: 18 }}>
        {glyph}
      </T>
    </Pressable>
  );
}

/** Pill-shaped choice used for reasons, weekdays and quick picks. */
export function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        haptic.tick();
        onPress();
      }}
      style={({ pressed }) => ({ minHeight: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: on ? p.primary : p.inset, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 })}
    >
      <T v="label" color={on ? p.onPrimary : p.textBody}>
        {label}
      </T>
    </Pressable>
  );
}
