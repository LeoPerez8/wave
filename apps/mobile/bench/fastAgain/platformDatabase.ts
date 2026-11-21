/**
 * Desktop bootstrap boundary for LibraryStore. Its reads and Effect layer
 * are unchanged; open/drizzle hand it the already migrated sql.js database.
 * Only LibraryStore's platform imports resolve here (never testDatabase's).
 */
import { asyncReadClient, type TestDatabase } from "@wave/client/testing";
import type { AsyncSqlite } from "@wave/client/db/offThreadReads";

let database: TestDatabase | undefined;
/**
 * expo-sqlite's asynchronous opener, when the bench asks for off-thread reads:
 * they then replay against the same fixture (#1348). Without it, every read
 * runs synchronously on the fixture, as the store's tests expect.
 */
export let openDatabaseAsync: (() => Promise<AsyncSqlite>) | undefined;
export const setDesktopDatabase = (
  db: TestDatabase,
  options: { readonly offThreadReads?: boolean } = {},
): void => {
  database = db;
  openDatabaseAsync = options.offThreadReads ? async () => asyncReadClient(db) : undefined;
};
export const openDatabaseSync = () => {
  if (database === undefined) throw new Error("no desktop fixture database selected");
  return {
    database,
    // The fixture already enabled foreign keys. WAL is a phone-only setting.
    execSync: (_sql: string): void => {},
  };
};
export const drizzle = (client: ReturnType<typeof openDatabaseSync>) => client.database;
// openTestDatabase has already applied every migration to this fixture.
export const migrate = async (): Promise<void> => {};
