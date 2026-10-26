import type { Equipment, ExerciseKind, Muscle, Routine, ScheduleEntry, Weekday } from '@fit/core';
import { formatMinutes } from '@fit/core';
import { weekdayShort } from '@/lib/format';

export const MUSCLE_LABEL: Record<Muscle, string> = {
  abdominals: 'Abs',
  abductors: 'Abductors',
  adductors: 'Adductors',
  biceps: 'Biceps',
  calves: 'Calves',
  chest: 'Chest',
  forearms: 'Forearms',
  glutes: 'Glutes',
  hamstrings: 'Hamstrings',
  lats: 'Lats',
  lower_back: 'Lower back',
  middle_back: 'Middle back',
  neck: 'Neck',
  quadriceps: 'Quads',
  shoulders: 'Shoulders',
  traps: 'Traps',
  triceps: 'Triceps',
};

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  bodyweight: 'Bodyweight',
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  cable: 'Cable',
  machine: 'Machine',
  bands: 'Bands',
  ez_bar: 'EZ bar',
  medicine_ball: 'Medicine ball',
  exercise_ball: 'Exercise ball',
  foam_roller: 'Foam roller',
  other: 'Other',
  none: 'No equipment',
};

export const KIND_LABEL: Record<ExerciseKind, string> = {
  strength: 'Strength',
  stretch: 'Stretch',
  cardio: 'Cardio',
  plyometric: 'Plyometric',
};

/** "6 exercises, 50 min" or "7 moves, 9 min". */
export function routineSub(r: Routine): string {
  const what = r.kind === 'strength' ? (r.itemCount === 1 ? 'exercise' : 'exercises') : r.itemCount === 1 ? 'move' : 'moves';
  return `${r.itemCount} ${what}, ${formatMinutes(r.estSeconds)}`;
}

/** Scheduled weekdays for a routine: "Mon, Thu", or empty. */
export function routineDays(routineId: string, schedule: readonly ScheduleEntry[]): string {
  const days = [...new Set(schedule.filter((e) => e.routineId === routineId).map((e) => e.weekday))].sort((a, b) => a - b) as Weekday[];
  return days.map(weekdayShort).join(', ');
}
