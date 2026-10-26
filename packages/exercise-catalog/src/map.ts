import type { CatalogExercise, Equipment, ExerciseKind, Level, Muscle, Overrides, SourceExercise, Tracking } from './types';
import { MUSCLES } from './types';

/** Pure mapping from the source format to our catalog (spec §9 import pipeline, step 2-3). */

export function slugOf(sourceId: string): string {
  return sourceId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Sentence case with the copy rules: "Barbell Bench Press - Medium Grip" becomes
 * "Barbell bench press, medium grip". All-caps tokens (EZ, SMR, IT) are kept.
 */
export function cleanName(name: string): string {
  const words = name.replace(/\s+-\s+/g, ', ').replace(/\s+/g, ' ').trim().split(' ');
  return words
    .map((w, i) => {
      if (/^[A-Z0-9/-]{2,}$/.test(w.replace(/[(),]/g, ''))) return w;
      const lower = w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

const KIND: Record<string, ExerciseKind> = {
  strength: 'strength',
  powerlifting: 'strength',
  'olympic weightlifting': 'strength',
  strongman: 'strength',
  stretching: 'stretch',
  plyometrics: 'plyometric',
  cardio: 'cardio',
};

const EQUIP: Record<string, Equipment> = {
  'body only': 'bodyweight',
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  bands: 'bands',
  'e-z curl bar': 'ez_bar',
  'medicine ball': 'medicine_ball',
  'exercise ball': 'exercise_ball',
  'foam roll': 'foam_roller',
  other: 'other',
};

const LOADED: readonly Equipment[] = ['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'ez_bar', 'medicine_ball'];

function muscle(m: string): Muscle {
  const key = m.replace(/\s+/g, '_') as Muscle;
  if (!(MUSCLES as readonly string[]).includes(key)) throw new Error(`Unknown muscle "${m}"`);
  return key;
}

function tracking(kind: ExerciseKind, equipment: Equipment, force: string | null): Tracking {
  if (kind === 'stretch' || kind === 'cardio' || force === 'static') return 'time';
  if (LOADED.includes(equipment)) return 'weight_reps';
  return 'reps';
}

/** One-sided stretches say so in their instructions; those expand to left and right. */
const TWO_SIDED = /\b(other side|opposite side|each side|switch sides|other leg|opposite leg|other arm|opposite arm|repeat on the other|both sides)\b/i;

export function mapExercise(src: SourceExercise, id: string, overrides: Overrides = {}): CatalogExercise | undefined {
  const slug = slugOf(src.id);
  if (overrides.hide?.includes(slug)) return undefined;

  const kind = KIND[src.category];
  if (!kind) throw new Error(`Unknown category "${src.category}" on ${src.id}`);
  const equipment = src.equipment ? EQUIP[src.equipment] : 'none';
  if (!equipment) throw new Error(`Unknown equipment "${src.equipment}" on ${src.id}`);
  const primary = src.primaryMuscles[0];
  if (!primary) throw new Error(`No primary muscle on ${src.id}`);

  const m = overrides.muscles?.[slug];
  const sides = overrides.sides?.[slug] ?? (kind === 'stretch' && TWO_SIDED.test(src.instructions.join(' ')) ? 'both' : 'none');

  const ex: CatalogExercise = {
    id,
    slug,
    name: overrides.rename?.[slug] ?? cleanName(src.name),
    kind,
    musclePrimary: m?.primary ?? muscle(primary),
    musclesSecondary: m?.secondary ?? src.secondaryMuscles.map(muscle),
    equipment,
    tracking: overrides.tracking?.[slug] ?? tracking(kind, equipment, src.force),
    level: src.level as Level,
    instructions: src.instructions,
    imageKeys: src.images.map((_, i) => `${slug}/${i}`),
    sides,
    aliases: overrides.aliases?.[slug] ?? [],
    sourceRef: src.id,
  };
  if (kind === 'stretch') ex.defaultHoldS = 30;
  return ex;
}
