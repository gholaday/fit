/**
 * Number pad for the set rows (weight and reps), docked under the list like Hevy's: digits,
 * a decimal point for weight, backspace, minus and plus one step, and Next to the next field.
 * The pad only edits a text buffer; the logger turns it into numbers.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { T } from '@/ui/primitives';

export type PadKey = { type: 'digit'; d: string } | { type: 'dot' } | { type: 'back' } | { type: 'step'; dir: 1 | -1 } | { type: 'next' };

/** Height of the pad without the bottom inset, so the list can leave room for it. */
export const PAD_HEIGHT = 300;

/**
 * Applies a key to the buffer. `fresh` means the value was just focused or stepped, so the
 * next digit replaces it instead of appending.
 */
export function pressKey(buf: string, fresh: boolean, key: PadKey, decimals: boolean, step: number): string | undefined {
  switch (key.type) {
    case 'digit': {
      const next = fresh ? key.d : buf === '0' ? key.d : buf + key.d;
      return (decimals ? /^\d{1,4}(\.\d?)?$/ : /^\d{1,3}$/).test(next) ? next : undefined;
    }
    case 'dot':
      if (!decimals) return undefined;
      if (fresh || buf === '') return '0.';
      return buf.includes('.') ? undefined : `${buf}.`;
    case 'back':
      return fresh ? '' : buf.slice(0, -1);
    case 'step': {
      const n = Math.max(0, Math.round(((Number.parseFloat(buf) || 0) + key.dir * step) * 10) / 10);
      return String(n);
    }
    case 'next':
      return undefined;
  }
}

export function NumPad({ title, step, decimals, onKey, onRemove, onHide }: { title: string; step: number; decimals: boolean; onKey: (k: PadKey) => void; onRemove: () => void; onHide: () => void }) {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const press = (k: PadKey) => {
    haptic.tick();
    onKey(k);
  };
  const digit = (d: string) => <Key key={d} label={d} onPress={() => press({ type: 'digit', d })} />;
  const stepText = String(step);
  return (
    <Animated.View entering={SlideInDown.duration(180)} exiting={SlideOutDown.duration(150)} style={[s.pad, { paddingBottom: insets.bottom + 8 }]}>
      <View style={s.bar}>
        <T v="labelStrong" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
          {title}
        </T>
        <Pressable accessibilityRole="button" onPress={onRemove} hitSlop={8} style={s.barBtn}>
          <T v="label" tone="secondary">
            Remove set
          </T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Hide number pad" onPress={onHide} hitSlop={8} style={s.barBtn}>
          <Icons.chevronDown size={20} color={p.text} />
        </Pressable>
      </View>
      <View style={s.grid}>
        <View style={s.digits}>
          <View style={s.row}>{['1', '2', '3'].map(digit)}</View>
          <View style={s.row}>{['4', '5', '6'].map(digit)}</View>
          <View style={s.row}>{['7', '8', '9'].map(digit)}</View>
          <View style={s.row}>
            {decimals ? <Key label="." accessibilityLabel="Decimal point" onPress={() => press({ type: 'dot' })} /> : <View style={{ flex: 1 }} />}
            {digit('0')}
            <Key accessibilityLabel="Delete" onPress={() => press({ type: 'back' })}>
              <Icons.backspace size={22} color={p.text} />
            </Key>
          </View>
        </View>
        <View style={s.side}>
          <Key label={`-${stepText}`} accessibilityLabel={`Minus ${stepText}`} tint onPress={() => press({ type: 'step', dir: -1 })} />
          <Key label={`+${stepText}`} accessibilityLabel={`Plus ${stepText}`} tint onPress={() => press({ type: 'step', dir: 1 })} />
          <Key label="Next" primary grow onPress={() => press({ type: 'next' })} />
        </View>
      </View>
    </Animated.View>
  );
}

function Key({ label, accessibilityLabel, onPress, children, tint, primary, grow }: { label?: string; accessibilityLabel?: string; onPress: () => void; children?: ReactNode; tint?: boolean; primary?: boolean; grow?: boolean }) {
  const s = useStyles();
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={({ pressed }) => [s.key, tint && { backgroundColor: p.inset }, primary && { backgroundColor: p.primary }, grow && { flex: 2 }, pressed && { opacity: 0.6 }]}
    >
      {children ?? (
        <T v="title" num color={primary ? p.onPrimary : p.text} style={primary ? { fontSize: 17 } : undefined}>
          {label}
        </T>
      )}
    </Pressable>
  );
}

const useStyles = createStyles((p) => ({
  pad: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: p.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 10, paddingTop: 6, gap: 6, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: -2 }, elevation: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingLeft: 6 },
  barBtn: { height: 36, minWidth: 36, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: 6, height: PAD_HEIGHT - 52 },
  digits: { flex: 3, gap: 6 },
  row: { flex: 1, flexDirection: 'row', gap: 6 },
  side: { flex: 1, gap: 6 },
  key: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg },
}));
