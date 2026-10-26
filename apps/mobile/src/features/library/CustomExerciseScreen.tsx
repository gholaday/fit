/** Add an exercise the catalog does not have. */
import { type Equipment, EQUIPMENT, type ExerciseKind, type Muscle, MUSCLES, type Tracking } from '@fit/core';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { repo } from '@/data';
import { actions, showSnack } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { createStyles, usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, Chip, Group, IconButton, NumStepper, Row, Segmented, T } from '@/ui/primitives';
import { EQUIPMENT_LABEL, KIND_LABEL, MUSCLE_LABEL } from './labels';

const KINDS: readonly ExerciseKind[] = ['strength', 'stretch', 'cardio', 'plyometric'];
const TRACKING: readonly { value: Tracking; label: string }[] = [
  { value: 'weight_reps', label: 'Weight, reps' },
  { value: 'reps', label: 'Reps' },
  { value: 'time', label: 'Time' },
];

export function CustomExerciseScreen() {
  const s = useStyles();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExerciseKind>('strength');
  const [muscle, setMuscle] = useState<Muscle>('chest');
  const [equipment, setEquipment] = useState<Equipment>('dumbbell');
  const [tracking, setTracking] = useState<Tracking>('weight_reps');
  const [sides, setSides] = useState<'both' | 'none'>('both');
  const [hold, setHold] = useState(30);
  const [note, setNote] = useState('');
  const stretch = kind === 'stretch';

  const save = () => {
    repo.addCustomExercise({
      name: name.trim(),
      kind,
      musclePrimary: muscle,
      equipment,
      tracking: stretch ? 'time' : tracking,
      ...(stretch ? { sides, defaultHoldS: hold } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    actions.reload();
    haptic.success();
    showSnack({ message: `${name.trim()} added` });
    router.back();
  };

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 8 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <IconButton label="Close" size={40} onPress={() => router.back()}>
            <Icons.x size={20} color={p.text} />
          </IconButton>
          <T v="headline">New exercise</T>
        </View>
        <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={p.textTertiary} accessibilityLabel="Exercise name" style={s.input} autoFocus />

        <Label text="Kind" />
        <View style={s.chips}>
          {KINDS.map((k) => (
            <Chip key={k} label={KIND_LABEL[k]} on={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>

        <Label text="Main muscle" />
        <View style={s.chips}>
          {MUSCLES.map((m) => (
            <Chip key={m} label={MUSCLE_LABEL[m]} on={muscle === m} onPress={() => setMuscle(m)} />
          ))}
        </View>

        <Label text="Equipment" />
        <View style={s.chips}>
          {EQUIPMENT.map((e) => (
            <Chip key={e} label={EQUIPMENT_LABEL[e]} on={equipment === e} onPress={() => setEquipment(e)} />
          ))}
        </View>

        {stretch ? (
          <Group>
            <Row label="Sides">
              <View style={{ width: 170 }}>
                <Segmented
                  look="inset"
                  options={[
                    { value: 'both', label: 'Both' },
                    { value: 'none', label: 'One' },
                  ]}
                  value={sides}
                  onChange={setSides}
                />
              </View>
            </Row>
            <Row label="Hold" last>
              <NumStepper label="Hold" value={hold} min={10} max={180} step={5} format={(n) => `${n} s`} onChange={setHold} />
            </Row>
          </Group>
        ) : (
          <>
            <Label text="Track" />
            <Segmented look="inset" options={TRACKING} value={tracking} onChange={setTracking} />
          </>
        )}

        <TextInput value={note} onChangeText={setNote} placeholder="Note, optional" placeholderTextColor={p.textTertiary} accessibilityLabel="Note" style={[s.input, { minHeight: 72, textAlignVertical: 'top', paddingTop: 12 }]} multiline />
      </ScrollView>
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Add exercise" disabled={name.trim() === ''} onPress={save} />
      </View>
    </View>
  );
}

function Label({ text }: { text: string }) {
  return (
    <T v="labelStrong" tone="secondary">
      {text}
    </T>
  );
}

const useStyles = createStyles((p) => ({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { minHeight: 48, borderRadius: 12, backgroundColor: p.surface, paddingHorizontal: 14, color: p.text, fontFamily: 'Inter', fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
}));
