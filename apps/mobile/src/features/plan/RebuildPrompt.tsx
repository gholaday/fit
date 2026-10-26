/**
 * "Rebuild plan from here?" after 2 or more missed weeks (spec §8 adaptation). Rebuilding
 * makes a new plan with the same inputs starting today; Not now keeps the plan as it is.
 */
import { View } from 'react-native';
import { actions, showSnack, useFit } from '@/data/store';
import { haptic } from '@/lib/haptics';
import { Sheet } from '@/ui/Sheet';
import { Button, T } from '@/ui/primitives';

export function RebuildPrompt() {
  const open = useFit((s) => s.rebuildPrompt);
  const plan = useFit((s) => s.plan);
  const rebuild = () => {
    const created = actions.rebuildPlan();
    haptic.success();
    showSnack({ message: `${created.name} plan rebuilt, ${created.weeks} weeks` });
  };
  return (
    <Sheet visible={open && plan !== undefined} onClose={actions.dismissRebuild} title="Rebuild plan from here?">
      <View style={{ gap: 10 }}>
        <T v="body" tone="secondary">
          {`You missed 2 or more weeks of ${plan?.name ?? 'your plan'}. Rebuilding starts it again from this week with the same settings.`}
        </T>
        <Button label="Rebuild plan" onPress={rebuild} />
        <Button label="Not now" kind="outline" onPress={actions.dismissRebuild} />
      </View>
    </Sheet>
  );
}
