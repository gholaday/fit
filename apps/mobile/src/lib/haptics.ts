/**
 * Haptics vocabulary, so the same kind of action always feels the same.
 * Fire-and-forget: never awaited, never delays the action.
 */
import * as Haptics from 'expo-haptics';

let lastAt = 0;
/**
 * One pulse per press: a second haptic within 80 ms is dropped. Buttons fire their light
 * tap after the press handler, so a handler's own success or warning wins.
 */
function fire(run: () => Promise<void>): void {
  const now = Date.now();
  if (now - lastAt < 80) return;
  lastAt = now;
  run().catch(() => undefined);
}

export const haptic = {
  /** Picking a value: segmented control, chip, tab, stepper, hovering a day while dragging. */
  tick(): void {
    fire(() => Haptics.selectionAsync());
  },
  /** Pressing a button: the light tap every Button and IconButton gives. */
  tap(): void {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },
  /** Committing a local action: Done, Skip, Save, Move, Undo. */
  commit(): void {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },
  /** Lifting something: drag pickup on the Plan week. */
  lift(): void {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },
  /** A checked set beat a record: the trophy on the set row. */
  record(): void {
    fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
  },
  /** Finishing a flow: plan created, zones saved. */
  success(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  /** A warning the user should notice: back-to-back hard days. */
  warn(): void {
    fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },
};
