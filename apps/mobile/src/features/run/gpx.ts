/**
 * GPX in and out (spec §5): share a recorded run as a .gpx file through the system share
 * sheet, and read a route from a .gpx file (a Garmin Connect export) for a watch-only run.
 */
import { type HrSample, parseGpx, type ParsedGpx, toGpx, type TrackPoint } from '@fit/core';
import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

const fileName = (name: string, startedAt: string) => `${startedAt.slice(0, 10)} ${name}`.replace(/[^A-Za-z0-9 -]+/g, '').trim().replace(/\s+/g, '-') || 'run';

/** Writes the run to the cache and opens the share sheet. False when sharing is unavailable. */
export async function shareGpx(run: { name: string; startedAt: string; points: readonly TrackPoint[]; hr?: readonly HrSample[] }): Promise<boolean> {
  if (!(await isAvailableAsync())) return false;
  const file = new File(Paths.cache, `${fileName(run.name, run.startedAt)}.gpx`);
  file.create({ overwrite: true });
  file.write(toGpx(run));
  await shareAsync(file.uri, { mimeType: 'application/gpx+xml', dialogTitle: 'Share GPX file', UTI: 'com.topografix.gpx' });
  return true;
}

/** Lets the user pick a .gpx file. Undefined when canceled; throws when the file has no track points. */
export async function pickGpx(): Promise<ParsedGpx | undefined> {
  // Android reports GPX under several MIME types; filter by content instead.
  const r = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (r.canceled) return undefined;
  const parsed = parseGpx(await new File(r.assets[0]!.uri).text());
  if (parsed.points.length < 2) throw new Error('No track points in this file');
  return parsed;
}
