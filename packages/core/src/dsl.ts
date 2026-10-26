import type { Activity, Duration, PaceZone, RepeatBlock, Step, Target, WorkoutItem } from './workout';
import { PACE_ZONES } from './workout';

/**
 * Tiny workout DSL used by plan templates and quick text entry (spec §8).
 *
 *   workout  := item (',' item)*
 *   item     := repeat | step
 *   repeat   := INT ('x' | '×') '[' step (',' step)* ']'
 *   step     := [label ':'] duration [word] ['@' target]
 *   duration := 'open' | 90s | 10min | 1h | 1:30 | 800m | 1.5km | 2mi
 *   word     := walk | run | sprint | rest | easy | steady | tempo | threshold | interval | repetition
 *   target   := pace zone | Z1..Z5 | RPE n | 128-145 bpm | under 140 bpm | <140 bpm
 *             | 7:55-8:15 /mi | 4:50-5:00 /km
 *
 * Bare "m" is ambiguous: below 100 it means minutes ("10m easy"), 100 and up it
 * means meters ("800m @ interval"). Use "min" or "km" to be explicit.
 * Pace-zone words after the duration imply a run at that zone ("10m easy").
 * Without an activity word the step is a run; sprints default to RPE 9.
 */

export class DslError extends Error {
  constructor(message: string, readonly input: string) {
    super(`${message} in "${input}"`);
    this.name = 'DslError';
  }
}

export type IdGen = () => string;

const ACTIVITY_WORDS: Record<string, Activity> = {
  walk: 'walk',
  run: 'run',
  jog: 'run',
  sprint: 'sprint',
  sprints: 'sprint',
  rest: 'rest',
};

const METERS_PER_MILE = 1609.344;

function parseDuration(token: string, input: string): Duration {
  const t = token.toLowerCase();
  if (t === 'open') return { type: 'open' };
  const clock = /^(\d+):([0-5]\d)$/.exec(t);
  if (clock) return { type: 'time', seconds: Number(clock[1]) * 60 + Number(clock[2]) };
  const m = /^(\d+(?:\.\d+)?)(s|sec|min|m|h|km|mi)$/.exec(t);
  if (!m) throw new DslError(`Unknown duration "${token}"`, input);
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
    case 'sec':
      return { type: 'time', seconds: Math.round(n) };
    case 'min':
      return { type: 'time', seconds: Math.round(n * 60) };
    case 'h':
      return { type: 'time', seconds: Math.round(n * 3600) };
    case 'm':
      return n < 100 ? { type: 'time', seconds: Math.round(n * 60) } : { type: 'distance', meters: Math.round(n) };
    case 'km':
      return { type: 'distance', meters: Math.round(n * 1000) };
    default:
      return { type: 'distance', meters: Math.round(n * METERS_PER_MILE) };
  }
}

function paceToSecPerKm(clock: string, unit: 'mi' | 'km'): number {
  const [min, sec] = clock.split(':').map(Number);
  const s = (min ?? 0) * 60 + (sec ?? 0);
  return unit === 'mi' ? Math.round(s / (METERS_PER_MILE / 1000)) : s;
}

function parseTarget(raw: string, input: string): Target {
  const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (t === '' || t === 'none') return { type: 'none' };
  if ((PACE_ZONES as readonly string[]).includes(t)) return { type: 'pace_zone', zone: t as PaceZone };
  const z = /^z(?:one ?)?([1-5])$/.exec(t);
  if (z) return { type: 'hr_zone', zone: Number(z[1]) as 1 | 2 | 3 | 4 | 5 };
  const rpe = /^rpe ?(\d+(?:\.\d+)?)$/.exec(t);
  if (rpe) {
    const value = Number(rpe[1]);
    if (value < 1 || value > 10) throw new DslError('RPE must be 1-10', input);
    return { type: 'effort', rpe: value };
  }
  const hrRange = /^(\d{2,3}) ?- ?(\d{2,3}) ?bpm$/.exec(t);
  if (hrRange) {
    const minBpm = Number(hrRange[1]);
    const maxBpm = Number(hrRange[2]);
    if (minBpm >= maxBpm) throw new DslError('Heart rate range must go low to high', input);
    return { type: 'hr_range', minBpm, maxBpm };
  }
  const hrMax = /^(?:under |<) ?(\d{2,3}) ?bpm$/.exec(t);
  if (hrMax) return { type: 'hr_max', maxBpm: Number(hrMax[1]) };
  const pace = /^(\d{1,2}:[0-5]\d) ?- ?(\d{1,2}:[0-5]\d) ?\/ ?(mi|km)$/.exec(t);
  if (pace) {
    const unit = pace[3] as 'mi' | 'km';
    const a = paceToSecPerKm(pace[1]!, unit);
    const b = paceToSecPerKm(pace[2]!, unit);
    return { type: 'pace_range', minSecPerKm: Math.min(a, b), maxSecPerKm: Math.max(a, b) };
  }
  throw new DslError(`Unknown target "${raw.trim()}"`, input);
}

function parseStep(src: string, input: string, newId: IdGen): Step {
  let text = src.trim();
  if (text === '') throw new DslError('Empty step', input);

  let label: string | undefined;
  const colon = /^([A-Za-z][A-Za-z ]*?):\s*(.+)$/.exec(text);
  if (colon) {
    label = colon[1]!.trim();
    text = colon[2]!;
  }

  let targetSrc: string | undefined;
  const at = text.indexOf('@');
  if (at >= 0) {
    targetSrc = text.slice(at + 1);
    text = text.slice(0, at).trim();
  }

  const words = text.split(/\s+/).filter(Boolean);
  const [durationToken, word, ...extra] = words;
  if (!durationToken) throw new DslError('Missing duration', input);
  if (extra.length > 0) throw new DslError(`Unexpected "${extra.join(' ')}"`, input);

  const duration = parseDuration(durationToken, input);
  let activity: Activity = 'run';
  let target: Target = targetSrc !== undefined ? parseTarget(targetSrc, input) : { type: 'none' };

  if (word) {
    const w = word.toLowerCase();
    if (w in ACTIVITY_WORDS) {
      activity = ACTIVITY_WORDS[w]!;
    } else if ((PACE_ZONES as readonly string[]).includes(w)) {
      if (targetSrc !== undefined) throw new DslError(`Both "${word}" and a target given`, input);
      target = { type: 'pace_zone', zone: w as PaceZone };
    } else {
      throw new DslError(`Unknown activity "${word}"`, input);
    }
  }

  if (activity === 'sprint') {
    // Sprints are always time-based with an effort target (spec §4 rules).
    if (duration.type !== 'time') throw new DslError('Sprints must be time based', input);
    if (target.type === 'none') target = { type: 'effort', rpe: 9 };
    if (target.type !== 'effort') throw new DslError('Sprints use an effort target', input);
  }

  const step: Step = { id: newId(), activity, duration, target };
  if (label) step.label = label;
  return step;
}

/** Split on commas that are not inside [ ]. */
function splitTopLevel(src: string, input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth < 0) throw new DslError('Unmatched "]"', input);
    } else if (c === ',' && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) throw new DslError('Unclosed "["', input);
  parts.push(src.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

export function parseWorkout(input: string, newId: IdGen): WorkoutItem[] {
  const items: WorkoutItem[] = [];
  for (const part of splitTopLevel(input, input)) {
    const rep = /^(\d+)\s*[x×]\s*\[(.*)\]$/s.exec(part);
    if (rep) {
      const repeat = Number(rep[1]);
      if (repeat < 1) throw new DslError('Repeat count must be at least 1', input);
      if (rep[2]!.includes('[')) throw new DslError('Repeat blocks cannot nest', input);
      const block: RepeatBlock = {
        id: newId(),
        repeat,
        steps: splitTopLevel(rep[2]!, input).map((s) => parseStep(s, input, newId)),
      };
      if (block.steps.length === 0) throw new DslError('Empty repeat block', input);
      items.push(block);
    } else {
      if (part.includes('[') || part.includes(']')) throw new DslError('Malformed repeat block', input);
      items.push(parseStep(part, input, newId));
    }
  }
  if (items.length === 0) throw new DslError('Empty workout', input);
  return items;
}

/** Replace `{{name}}` placeholders. Unknown names are an error, not a silent blank. */
export function renderTemplate(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`Template variable "${name}" not provided`);
    return String(v);
  });
}

/** Deterministic id generator for tests and seeded content. */
export function counterIds(prefix = 's'): IdGen {
  let n = 0;
  return () => `${prefix}${++n}`;
}
