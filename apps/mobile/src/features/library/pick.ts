/**
 * Hand-off between the routine editor and the exercise list in pick mode. The editor
 * registers where picks go before opening the list; the list delivers and goes back.
 */
import type { ExerciseSummary } from '@fit/core';

let target: ((picked: ExerciseSummary[]) => void) | undefined;

export function onExercisesPicked(fn: (picked: ExerciseSummary[]) => void): void {
  target = fn;
}

export function deliverPicked(picked: ExerciseSummary[]): void {
  target?.(picked);
  target = undefined;
}
