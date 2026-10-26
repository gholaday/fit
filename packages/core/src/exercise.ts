import type { RoutineItems } from './routine';

/**
 * Exercise catalog types (spec §9, §13 `exercises`). Shared by the catalog build
 * (`@fit/exercise-catalog`), the SQLite repository and the app.
 */

export type ExerciseKind = 'strength' | 'stretch' | 'cardio' | 'plyometric';
export type Tracking = 'weight_reps' | 'reps' | 'time' | 'distance';
export type Level = 'beginner' | 'intermediate' | 'expert';

export const MUSCLES = [
  'abdominals',
  'abductors',
  'adductors',
  'biceps',
  'calves',
  'chest',
  'forearms',
  'glutes',
  'hamstrings',
  'lats',
  'lower_back',
  'middle_back',
  'neck',
  'quadriceps',
  'shoulders',
  'traps',
  'triceps',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = [
  'bodyweight',
  'barbell',
  'dumbbell',
  'kettlebell',
  'cable',
  'machine',
  'bands',
  'ez_bar',
  'medicine_ball',
  'exercise_ball',
  'foam_roller',
  'other',
  'none',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export interface Exercise {
  /** Our ULID, stable across catalog re-imports. */
  id: string;
  slug: string;
  name: string;
  kind: ExerciseKind;
  musclePrimary: Muscle;
  musclesSecondary: Muscle[];
  equipment: Equipment;
  tracking: Tracking;
  level: Level;
  instructions: string[];
  /** Image keys, e.g. "cat-stretch/0". Empty for custom exercises. */
  imageKeys: string[];
  sides: 'both' | 'none';
  defaultHoldS?: number;
  aliases: string[];
}

/** A starter routine as the catalog ships it. Read-only in the app; duplicate to edit. */
export type StarterRoutine = { slug: string; name: string } & RoutineItemsBody;

type RoutineItemsBody =
  | Omit<Extract<RoutineItems, { kind: 'stretch' }>, 'schemaVersion'>
  | Omit<Extract<RoutineItems, { kind: 'strength' }>, 'schemaVersion'>;

export interface CatalogExercise extends Exercise {
  /** Source id, for traceability only. */
  sourceRef: string;
}

export interface Catalog {
  /** The app re-seeds when the bundled version differs from the seeded one. */
  version: string;
  source: { repo: string; commit: string; license: string };
  exercises: CatalogExercise[];
  routines: StarterRoutine[];
}
