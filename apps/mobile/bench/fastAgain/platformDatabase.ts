/**
 * Desktop bootstrap boundary for LibraryStore. Its reads and Effect layer
 * are unchanged; open/drizzle hand it the already migrated sql.js database.
 * Only LibraryStore's platform imports resolve here (never testDatabase's).
 */
import type { TestDatabase } from "../../src/library/db/testDatabase.ts";

let database: TestDatabase | undefined;
export const setDesktopDatabase = (db: TestDatabase): void => {
  database = db;
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
