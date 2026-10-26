import type { DistanceUnit } from '../units';
import { METERS_PER_MILE, paceToUnit } from '../units';
import type { Activity, Step } from '../workout';

/**
 * Voice cue text (spec §5 Audio cues). Spoken words, not digits, so TTS reads them
 * naturally. Copy rules apply: no exclamation marks, no cheerleading.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0..999 in words: 152 -> "one hundred fifty-two". */
export function numberWords(n: number): string {
  const v = Math.round(Math.abs(n));
  if (v < 20) return ONES[v]!;
  if (v < 100) return TENS[Math.floor(v / 10)]! + (v % 10 ? `-${ONES[v % 10]}` : '');
  if (v < 1000) return `${ONES[Math.floor(v / 100)]} hundred${v % 100 ? ` ${numberWords(v % 100)}` : ''}`;
  return String(v);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Thirty seconds", "Ninety seconds", "Five minutes". */
export function durationWords(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 120) return `${numberWords(s)} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  return `${numberWords(m)} minute${m === 1 ? '' : 's'}`;
}

/** "Four hundred meters", "One point five miles". */
export function distanceWords(meters: number, unit: DistanceUnit): string {
  if (meters < 1000) return `${numberWords(roundTo(meters, 50))} meters`;
  const value = unit === 'mi' ? meters / METERS_PER_MILE : meters / 1000;
  const name = unit === 'mi' ? 'mile' : 'kilometer';
  const whole = Math.floor(value);
  const tenth = Math.round((value - whole) * 10);
  if (tenth === 0 || tenth === 10) {
    const w = tenth === 10 ? whole + 1 : whole;
    return `${numberWords(w)} ${name}${w === 1 ? '' : 's'}`;
  }
  return `${numberWords(whole)} point ${numberWords(tenth)} ${name}s`;
}

/** "nine twelve", "nine oh five", "ten flat". Pace in sec/km, spoken per unit. */
export function paceWords(secPerKm: number, unit: DistanceUnit): string {
  const total = Math.round(paceToUnit(secPerKm, unit));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s === 0) return `${numberWords(m)} flat`;
  return `${numberWords(m)} ${s < 10 ? `oh ${numberWords(s)}` : numberWords(s)}`;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

const ACTIVITY_WORD: Record<Activity, string> = {
  walk: 'Walk',
  run: 'Run',
  sprint: 'Sprint',
  rest: 'Rest',
  strength: 'Set',
  stretch: 'Stretch',
};

/** "Sprint. Thirty seconds." Uses the step's custom cue or label when set. */
export function stepChangeText(step: Step, unit: DistanceUnit): string {
  if (step.cue) return step.cue;
  const name = step.label ?? ACTIVITY_WORD[step.activity];
  const d = step.duration;
  if (d.type === 'time') return `${name}. ${cap(durationWords(d.seconds))}.`;
  if (d.type === 'distance') return `${name}. ${cap(distanceWords(d.meters, unit))}.`;
  return `${name}.`;
}

/** "One mile. Nine twelve. Average pace nine eighteen." */
export function splitText(index: number, splitSecPerKm: number, avgSecPerKm: number, unit: DistanceUnit): string {
  const name = unit === 'mi' ? 'mile' : 'kilometer';
  return `${cap(numberWords(index))} ${name}${index === 1 ? '' : 's'}. ${cap(paceWords(splitSecPerKm, unit))}. Average pace ${paceWords(avgSecPerKm, unit)}.`;
}
