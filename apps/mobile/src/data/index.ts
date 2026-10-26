import type { FitRepository } from '@fit/core';
import { createFakeRepository } from './fake';

/**
 * The one repository the app talks to. Swap this line for
 * `createSqliteRepository(db)` from @fit/schema when it lands.
 */
export const repo: FitRepository = createFakeRepository();
