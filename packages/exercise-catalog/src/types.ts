import type { CatalogExercise, Muscle, Tracking } from '@fit/core';

export type { Catalog, CatalogExercise, Equipment, ExerciseKind, Level, Muscle, StarterRoutine, Tracking } from '@fit/core';
export { EQUIPMENT, MUSCLES } from '@fit/core';

/**
 * Our exercise catalog format (spec §9, §13 `exercises`). The app and database own
 * this shape; the free-exercise-db source format never reaches the app.
 */

/** One record of yuhonas/free-exercise-db `dist/exercises.json`. */
export interface SourceExercise {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

/** overrides.yaml, keyed by our slug. Survives re-imports. */
export interface Overrides {
  rename?: Record<string, string>;
  hide?: string[];
  aliases?: Record<string, string[]>;
  sides?: Record<string, 'both' | 'none'>;
  tracking?: Record<string, Tracking>;
  muscles?: Record<string, { primary?: Muscle; secondary?: Muscle[] }>;
  /** Exercises the source lacks. */
  add?: Omit<CatalogExercise, 'id' | 'sourceRef' | 'imageKeys'>[];
}
