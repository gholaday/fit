import { describe, expect, it } from 'vitest';
import { cleanName, mapExercise } from './map';
import type { SourceExercise } from './types';

const src = (over: Partial<SourceExercise>): SourceExercise => ({
  id: 'Barbell_Bench_Press_-_Medium_Grip',
  name: 'Barbell Bench Press - Medium Grip',
  force: 'push',
  level: 'beginner',
  mechanic: 'compound',
  equipment: 'barbell',
  primaryMuscles: ['chest'],
  secondaryMuscles: ['shoulders', 'triceps'],
  instructions: ['Lie back on a flat bench.'],
  category: 'strength',
  images: ['Barbell_Bench_Press_-_Medium_Grip/0.jpg', 'Barbell_Bench_Press_-_Medium_Grip/1.jpg'],
  ...over,
});

describe('mapExercise', () => {
  it('maps a loaded lift to our schema', () => {
    expect(mapExercise(src({}), 'ID1')).toMatchObject({
      slug: 'barbell-bench-press-medium-grip',
      name: 'Barbell bench press, medium grip',
      kind: 'strength',
      equipment: 'barbell',
      tracking: 'weight_reps',
      musclesSecondary: ['shoulders', 'triceps'],
      imageKeys: ['barbell-bench-press-medium-grip/0', 'barbell-bench-press-medium-grip/1'],
    });
  });

  it('infers time tracking, a hold and two sides for one-sided stretches', () => {
    const ex = mapExercise(
      src({ id: 'Quad_Stretch', name: 'Quad Stretch', category: 'stretching', equipment: 'body only', primaryMuscles: ['quadriceps'], instructions: ['Hold your ankle.', 'Repeat on the other side.'] }),
      'ID2',
    );
    expect(ex).toMatchObject({ kind: 'stretch', tracking: 'time', sides: 'both', defaultHoldS: 30, equipment: 'bodyweight' });
  });

  it('applies overrides: rename, aliases, sides, hide', () => {
    const overrides = {
      rename: { 'barbell-bench-press-medium-grip': 'Bench press' },
      aliases: { 'barbell-bench-press-medium-grip': ['Flat bench'] },
      hide: ['quad-stretch'],
    };
    expect(mapExercise(src({}), 'ID1', overrides)).toMatchObject({ name: 'Bench press', aliases: ['Flat bench'] });
    expect(mapExercise(src({ id: 'Quad_Stretch', name: 'Quad Stretch' }), 'ID2', overrides)).toBeUndefined();
  });
});

describe('cleanName', () => {
  it('keeps acronyms', () => {
    expect(cleanName('IT Band and Glute Stretch')).toBe('IT band and glute stretch');
  });
});
