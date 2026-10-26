/**
 * Builds our exercise catalog from a pinned free-exercise-db commit (spec §9).
 * Run with `pnpm catalog:build`. Re-runnable: ids.json keeps ids stable, downloads are
 * cached in .cache/, and overrides.yaml and routines/*.yaml are applied every time.
 *
 * Output (committed):
 *   catalog.json              exercises + starter routines, versioned
 *   assets/thumbs/<slug>.webp first frame, 192 px, for every exercise (ships in the app)
 *   assets/detail/<slug>-<n>.webp both frames, 720 px, stretches only (guided player)
 *   src/images.generated.ts   static require() map so Metro bundles the images
 *   src/version.generated.ts  CATALOG_VERSION, so the app can skip loading catalog.json when seeded
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ulid } from 'ulid';
import { parse } from 'yaml';
import { mapExercise } from './map';
import type { Catalog, CatalogExercise, Overrides, SourceExercise, StarterRoutine } from './types';

const REPO = 'yuhonas/free-exercise-db';
const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const VERSION = '2026.10.1';
const RAW = `https://raw.githubusercontent.com/${REPO}/${COMMIT}`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
const path = (...p: string[]) => join(root, ...p);

async function fetchCached(url: string, file: string): Promise<Buffer> {
  const target = join(cache, file);
  if (existsSync(target)) return readFileSync(target);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, buf);
  return buf;
}

async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

interface RoutineYaml {
  name: string;
  kind: 'stretch' | 'strength';
  transitionS?: number;
  restS?: number;
  items: { slug: string; holdS?: number; sides?: 'both' | 'none'; sets?: number; reps?: number; restS?: number }[];
}

function resolveRoutine(slug: string, y: RoutineYaml, bySlug: Map<string, CatalogExercise>): StarterRoutine {
  const find = (s: string) => {
    const ex = bySlug.get(s);
    if (!ex) throw new Error(`Routine ${slug} references unknown or hidden exercise "${s}"`);
    return ex;
  };
  if (y.kind === 'stretch') {
    return {
      slug,
      kind: 'stretch',
      name: y.name,
      transitionS: y.transitionS ?? 8,
      items: y.items.map((i) => {
        const ex = find(i.slug);
        return { exerciseId: ex.id, holdS: i.holdS ?? ex.defaultHoldS ?? 30, sides: i.sides ?? ex.sides };
      }),
    };
  }
  const restS = y.restS ?? 90;
  return {
    slug,
    kind: 'strength',
    name: y.name,
    restS,
    items: y.items.map((i) => {
      if (!i.sets || !i.reps) throw new Error(`Routine ${slug}: "${i.slug}" needs sets and reps`);
      return { exerciseId: find(i.slug).id, sets: i.sets, reps: i.reps, restS: i.restS ?? restS };
    }),
  };
}

async function main() {
  const source = JSON.parse((await fetchCached(`${RAW}/dist/exercises.json`, 'exercises.json')).toString('utf8')) as SourceExercise[];
  const overrides = (parse(readFileSync(path('overrides.yaml'), 'utf8')) ?? {}) as Overrides;
  const ids: Record<string, string> = existsSync(path('ids.json')) ? JSON.parse(readFileSync(path('ids.json'), 'utf8')) : {};
  const idFor = (slug: string) => (ids[slug] ??= ulid());

  const sourceBySlug = new Map<string, SourceExercise>();
  const exercises: CatalogExercise[] = [];
  for (const src of source) {
    const probe = mapExercise(src, '', overrides);
    if (!probe) continue;
    exercises.push({ ...probe, id: idFor(probe.slug) });
    sourceBySlug.set(probe.slug, src);
  }
  for (const add of overrides.add ?? []) exercises.push({ ...add, id: idFor(add.slug), imageKeys: [], sourceRef: 'custom' });
  exercises.sort((a, b) => a.slug.localeCompare(b.slug));
  const bySlug = new Map(exercises.map((e) => [e.slug, e]));

  const routines = readdirSync(path('routines'))
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => resolveRoutine(f.replace(/\.yaml$/, ''), parse(readFileSync(path('routines', f), 'utf8')) as RoutineYaml, bySlug));

  // Images: thumbnails for everything, detail frames for stretches.
  mkdirSync(path('assets', 'thumbs'), { recursive: true });
  mkdirSync(path('assets', 'detail'), { recursive: true });
  let done = 0;
  await pool(
    exercises.filter((e) => sourceBySlug.has(e.slug)),
    16,
    async (ex) => {
      const src = sourceBySlug.get(ex.slug)!;
      const frames = ex.kind === 'stretch' ? src.images : src.images.slice(0, 1);
      for (const [i, img] of frames.entries()) {
        const raw = await fetchCached(`${RAW}/exercises/${img}`, join('images', img));
        if (i === 0) {
          const thumb = path('assets', 'thumbs', `${ex.slug}.webp`);
          if (!existsSync(thumb)) await sharp(raw).resize(192, 192, { fit: 'cover' }).webp({ quality: 55 }).toFile(thumb);
        }
        if (ex.kind === 'stretch') {
          const detail = path('assets', 'detail', `${ex.slug}-${i}.webp`);
          if (!existsSync(detail)) await sharp(raw).resize(720, undefined, { withoutEnlargement: true }).webp({ quality: 70 }).toFile(detail);
        }
      }
      if (++done % 100 === 0) console.log(`images ${done}/${exercises.length}`);
    },
  );

  const thumbs = exercises.filter((e) => existsSync(path('assets', 'thumbs', `${e.slug}.webp`)));
  const details = exercises.filter((e) => e.kind === 'stretch').flatMap((e) => e.imageKeys.map((_, i) => `${e.slug}-${i}`)).filter((k) => existsSync(path('assets', 'detail', `${k}.webp`)));
  writeFileSync(
    path('src', 'images.generated.ts'),
    '// Generated by src/build.ts. Do not edit.\n/* eslint-disable @typescript-eslint/no-require-imports */\n' +
      `export const thumbs: Record<string, number> = {\n${thumbs.map((e) => `  '${e.slug}': require('../assets/thumbs/${e.slug}.webp'),`).join('\n')}\n};\n\n` +
      `export const details: Record<string, number> = {\n${details.map((k) => `  '${k}': require('../assets/detail/${k}.webp'),`).join('\n')}\n};\n`,
  );

  const catalog: Catalog = { version: VERSION, source: { repo: REPO, commit: COMMIT, license: 'Unlicense' }, exercises, routines };
  writeFileSync(path('catalog.json'), JSON.stringify(catalog) + '\n');
  writeFileSync(path('src', 'version.generated.ts'), `// Generated by src/build.ts. Do not edit.\nexport const CATALOG_VERSION = '${VERSION}';\n`);
  writeFileSync(path('ids.json'), JSON.stringify(Object.fromEntries(Object.entries(ids).sort()), null, 1) + '\n');
  console.log(`catalog ${VERSION}: ${exercises.length} exercises, ${routines.length} routines, ${thumbs.length} thumbnails, ${details.length} detail images`);
}

await main();
