import { syncRequestSchema } from '@fit/sync';
import { isAuthorized } from '@/lib/auth';

/** Push/pull sync. Validates auth and the request shape; storage lands in M2.5. */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = syncRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', issues: parsed.error.issues }, { status: 400 });

  return Response.json({ error: 'not_implemented', message: 'Sync arrives in M2.5' }, { status: 501 });
}
