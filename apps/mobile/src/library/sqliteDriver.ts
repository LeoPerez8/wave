import { SqliteDriver, DatabaseError } from "@wave/client";
import { READ_CONNECTION_SETTINGS, readConnections } from "@wave/client/db/offThreadReads";
import * as schema from "@wave/client/db/schema";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { openDatabaseAsync, openDatabaseSync } from "expo-sqlite";

/**
 * The phone keeps the same file and connection lifetime as before the package
 * move. Writes stay on that connection, in order on the JS thread; reads go to
 * two more connections to the same file, run through expo-sqlite's
 * asynchronous API (#1348). Each opens on the first read, after the main
 * connection has migrated the file; WAL lets them read while it writes.
 */
export const sqliteDriverLayer = Layer.effect(
  SqliteDriver,
  Effect.try({
    try: () => {
      const client = openDatabaseSync("wave.db");
      return {
        db: drizzle(client, { schema }),
        exec: (statements: string) => client.execSync(statements),
        // Desktop benches load this file with no asynchronous connection: their reads stay here.
        reads:
          typeof openDatabaseAsync === "function"
            ? readConnections(async () => {
                const reader = await openDatabaseAsync("wave.db", { useNewConnection: true });
                await reader.execAsync(READ_CONNECTION_SETTINGS);
                return reader;
              })
            : undefined,
      };
    },
    catch: (cause) => new DatabaseError({ cause }),
  }),
);
