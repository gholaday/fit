import { useEffect, useState } from 'react';
import { TextInput } from 'react-native';
import { createStyles, usePalette } from '@/theme';
import { type } from '@/theme/type';

/**
 * Small numeric input. Commits on blur or submit so typing "1" on the way to "186"
 * never recomputes with a half-typed value.
 */
export function NumField({ value, onCommit, label, width = 72, placeholder }: { value: number | undefined; onCommit: (n: number | undefined) => void; label: string; width?: number; placeholder?: string }) {
  const s = useStyles();
  const p = usePalette();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    onCommit(text.trim() === '' || !Number.isFinite(n) ? undefined : Math.round(n));
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onEndEditing={commit}
      onSubmitEditing={commit}
      keyboardType="number-pad"
      returnKeyType="done"
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor={p.textTertiary}
      style={[s.input, { width }]}
      selectTextOnFocus
    />
  );
}

const useStyles = createStyles((p) => ({
  input: { ...type.statSm, color: p.text, height: 40, borderRadius: 10, backgroundColor: p.inset, paddingHorizontal: 10, paddingVertical: 0, textAlign: 'center' },
}));
