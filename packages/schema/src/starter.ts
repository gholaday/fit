/**
 * Starter routines so the Workout and Stretch lanes are usable in M0. Names only;
 * the exercise catalog and full routine items arrive in M1.5. Stretch moves follow
 * the starter list in spec §10.
 */
export interface StarterRoutine {
  kind: 'strength' | 'stretch';
  name: string;
  items: string[];
  estSeconds: number;
}

export const STARTER_ROUTINES: readonly StarterRoutine[] = [
  { kind: 'strength', name: 'Push', items: ['Bench press', 'Overhead press', 'Incline dumbbell press', 'Lateral raise', 'Triceps pushdown', 'Push-up'], estSeconds: 50 * 60 },
  { kind: 'strength', name: 'Pull', items: ['Pull-up', 'Barbell row', 'Lat pulldown', 'Face pull', 'Biceps curl'], estSeconds: 45 * 60 },
  { kind: 'strength', name: 'Legs', items: ['Back squat', 'Romanian deadlift', 'Walking lunge', 'Leg curl', 'Calf raise'], estSeconds: 50 * 60 },
  { kind: 'stretch', name: 'Morning', items: ['Cat-cow', 'Hip flexor stretch', 'Hamstring stretch', 'Thoracic rotation'], estSeconds: 6 * 60 },
  { kind: 'stretch', name: 'Evening', items: ['Pigeon', 'Figure-4', 'Calf stretch', "Child's pose"], estSeconds: 9 * 60 },
  { kind: 'stretch', name: 'Post-run', items: ['Quad stretch', 'Hamstring stretch', 'Calf stretch', 'Hip flexor stretch', 'Glute stretch'], estSeconds: 7 * 60 },
];
