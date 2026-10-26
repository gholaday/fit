import { timingSafeEqual } from 'node:crypto';

/** Single-user bearer token (spec §17), set as FIT_SYNC_TOKEN in Vercel. */
export function isAuthorized(request: Request): boolean {
  const expected = process.env.FIT_SYNC_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
