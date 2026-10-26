/**
 * Haptics vocabulary, so the same kind of action always feels the same.
 * Fire-and-forget: never awaited, never delays the action.
 */
import * as Haptics from 'expo-haptics';

function fire(p: Promise<void>): void {
  p.catch(() => undefined);
}

export const haptic = {
  /** Picking a value: segmented control, chip, tab, stepper, hovering a day while dragging. */
  tick(): void {
    fire(Haptics.selectionAsync());
  },
  /** Committing a local action: Done, Skip, Save, Move, Undo. */
  commit(): void {
    fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },
  /** Lifting something: drag pickup on the Plan week. */
  lift(): void {
    fire(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },
  /** Finishing a flow: plan created, zones saved. */
  success(): void {
    fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  /** A warning the user should notice: back-to-back hard days. */
  warn(): void {
    fire(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },
};
