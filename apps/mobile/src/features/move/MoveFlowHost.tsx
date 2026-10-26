import { weekdayOf } from '@fit/core';
import { View } from 'react-native';
import { useFit } from '@/data/store';
import { dayName } from '@/features/items/meta';
import { weekdayLong } from '@/lib/format';
import { usePalette } from '@/theme';
import { Icons } from '@/ui/icons';
import { Button, LaneTile, T } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { cancelMove, chooseScope, putBoth, swapWithOccupant, useMoveFlow } from './moveFlow';

/** The questions a move can raise. Rendered once at the root. */
export function MoveFlowHost() {
  const pending = useMoveFlow((s) => s.pending);
  const item = useFit((s) => (pending ? s.items[pending.key] : undefined));
  const today = useFit((s) => s.today);
  const p = usePalette();
  if (!pending || !item) return <Sheet visible={false} onClose={cancelMove} />;
  const day = dayName(pending.toDate, today);
  const occupant = pending.evaluation.occupants[0];

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <LaneTile lane={item.lane} size={40} />
      <View style={{ flex: 1 }}>
        <T v="sheetTitle">{pending.step === 'occupied' ? `${day} has ${occupant?.title ?? 'something'}` : `Move ${item.title}`}</T>
        <T v="label" tone="secondary">
          {pending.step === 'occupied' ? `Move ${item.title} there` : `${item.title} is on your schedule every ${weekdayLong(weekdayOf(item.originalDate))}`}
        </T>
      </View>
    </View>
  );

  return (
    <Sheet visible onClose={cancelMove} header={header}>
      {pending.step === 'occupied' ? (
        <View style={{ gap: 8 }}>
          {pending.evaluation.swapWarnings.length > 0 && <Note text="Swapping puts two hard days back to back." />}
          {pending.evaluation.warnings.length > 0 && pending.evaluation.swapWarnings.length === 0 && <Note text="Putting both there makes back-to-back hard days. Swapping does not." />}
          <Button label={`Swap with ${occupant?.title ?? ''}`} icon={<Icons.swap size={18} color={p.onPrimary} />} onPress={swapWithOccupant} />
          <Button label={`Put both on ${day}`} kind="outline" onPress={putBoth} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Button label="Just this time" onPress={() => chooseScope('once')} />
          <Button label={`Change the schedule to ${weekdayLong(weekdayOf(pending.toDate))}s`} kind="outline" onPress={() => chooseScope('schedule')} />
        </View>
      )}
    </Sheet>
  );
}

export function Note({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: p.bg }}>
      <View style={{ paddingTop: 1 }}>
        <Icons.info size={16} color={p.run.color} />
      </View>
      <T v="label" tone="body" style={{ flex: 1, fontWeight: '400' }}>
        {text}
      </T>
    </View>
  );
}
