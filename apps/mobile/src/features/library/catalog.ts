/**
 * Exercise catalog seeding. The catalog JSON (about 900 KB) is imported lazily and seeded
 * after first paint, only when the bundled version differs from the one in the database,
 * so startup never waits on it.
 */
import type { Catalog } from '@fit/core';
import { CATALOG_VERSION } from '@fit/exercise-catalog';
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
