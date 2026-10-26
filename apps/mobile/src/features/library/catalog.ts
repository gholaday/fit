/**
 * Exercise catalog: seeding and images. The catalog JSON (about 900 KB) is imported
 * lazily and seeded after first paint, only when the bundled version differs from the one
 * in the database, so startup never waits on it.
 */
import type { Catalog } from '@fit/core';
import { CATALOG_VERSION } from '@fit/exercise-catalog';
import { details, thumbs } from '@fit/exercise-catalog/images';
import { repo } from '@/data';
import { actions } from '@/data/store';

let seeding: Promise<void> | undefined;

export function seedCatalogIfNeeded(): Promise<void> {
  if (repo.catalogVersion() === CATALOG_VERSION) return Promise.resolve();
  seeding ??= import('@fit/exercise-catalog/catalog.json').then((m) => {
    repo.seedCatalog((m.default ?? m) as unknown as Catalog);
    actions.reload();
  });
  return seeding;
}

/** List thumbnail for an exercise's thumb key (its slug). */
export function thumbFor(key: string | undefined): number | undefined {
  return key ? thumbs[key] : undefined;
}

/** Full-size image for an image key like "cat-stretch/0". */
export function detailFor(imageKey: string): number | undefined {
  return details[imageKey.replace('/', '-')] ?? thumbs[imageKey.split('/')[0]!];
}
