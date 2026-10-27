import { type AgendaItem, type Lane, LANE_ORDER } from './agenda';

/**
 * The Today day ring: one arc per lane scheduled today, equal shares of the circle
 * (three lanes take a third each, two take half, one takes the whole ring). Each arc
 * fills by the share of that lane's items done. Steps sit on a separate outer ring.
 */

export interface RingArc {
  lane: Lane;
  /** Fractions of the circle, clockwise from 12 o'clock, with the gaps already taken out. */
  start: number;
  end: number;
  total: number;
  done: number;
  skipped: number;
  /** Share of the arc to fill, 0 to 1: done over total. Skipped items stay unfilled. */
  fill: number;
}

/** Gap between arcs, as a fraction of the circle. None when a single lane has the whole ring. */
export const RING_GAP = 0.025;

export function dayRing(items: readonly Pick<AgendaItem, 'lane' | 'status'>[], gap = RING_GAP): RingArc[] {
  const lanes = LANE_ORDER.filter((lane) => items.some((i) => i.lane === lane));
  const share = 1 / Math.max(1, lanes.length);
  const g = lanes.length > 1 ? gap : 0;
  return lanes.map((lane, idx) => {
    const own = items.filter((i) => i.lane === lane);
    const done = own.filter((i) => i.status === 'done').length;
    return {
      lane,
      start: idx * share + g / 2,
      end: (idx + 1) * share - g / 2,
      total: own.length,
      done,
      skipped: own.filter((i) => i.status === 'skipped').length,
      fill: done / own.length,
    };
  });
}

export interface RingLayout {
  /** Center line radius of the outer steps ring and the inner day ring. */
  stepsR: number;
  dayR: number;
  /** Stroke width of both rings. */
  width: number;
  /** Extra touch margin either side of a ring. */
  slop?: number;
}

export type RingHit = { ring: 'steps' } | { ring: 'day'; lane: Lane } | { ring: 'center' };

/**
 * Which part of the ring a touch landed on. `dx` and `dy` are offsets from the center in
 * the layout's units (y down). A touch in a gap picks the nearest arc; a day ring touch
 * with no lanes today, or a touch outside both rings, hits nothing.
 */
export function ringHit(dx: number, dy: number, arcs: readonly RingArc[], layout: RingLayout): RingHit | undefined {
  const r = Math.hypot(dx, dy);
  const half = layout.width / 2 + (layout.slop ?? 4);
  const boundary = (layout.stepsR + layout.dayR) / 2;
  if (r > layout.stepsR + half) return undefined;
  if (r >= boundary) return { ring: 'steps' };
  if (r < layout.dayR - half) return { ring: 'center' };
  if (arcs.length === 0) return undefined;
  const a = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
  const dist = (arc: RingArc) => {
    if (a >= arc.start && a <= arc.end) return 0;
    const d = Math.min(Math.abs(a - arc.start), Math.abs(a - arc.end));
    return Math.min(d, 1 - d);
  };
  let best = arcs[0]!;
  for (const arc of arcs) if (dist(arc) < dist(best)) best = arc;
  return { ring: 'day', lane: best.lane };
}
