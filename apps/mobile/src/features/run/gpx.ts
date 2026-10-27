/**
 * GPX import (spec §5): read a route from a .gpx file (a Garmin Connect export) for a
 * watch-only run. Export was removed; Fit keeps routes in the app.
 */
import { parseGpx, type ParsedGpx } from '@fit/core';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';

/** Lets the user pick a .gpx file. Undefined when canceled; throws when the file has no track points. */
export async function pickGpx(): Promise<ParsedGpx | undefined> {
  // Android reports GPX under several MIME types; filter by content instead.
  const r = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (r.canceled) return undefined;
  const parsed = parseGpx(await new File(r.assets[0]!.uri).text());
  if (parsed.points.length < 2) throw new Error('No track points in this file');
  return parsed;
}
