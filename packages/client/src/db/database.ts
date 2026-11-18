/** Types every query module over the library database shares. */
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import type * as schema from "./schema.ts";

/** The library database, on the phone (expo-sqlite) or in tests (sql.js). */
export type LibraryDatabase = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

/** A window of a list: `limit` rows from `offset`. */
export interface RowPage {
  readonly offset: number;
  readonly limit: number;
}
