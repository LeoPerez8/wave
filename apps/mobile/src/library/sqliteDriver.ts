import { SqliteDriver, DatabaseError } from "@wave/client";
import * as schema from "@wave/client/db/schema";
import { drizzle } from "drizzle-orm/expo-sqlite";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { openDatabaseSync } from "expo-sqlite";

/** The phone keeps the same file and connection lifetime as before the package move. */
export const sqliteDriverLayer = Layer.effect(
  SqliteDriver,
  Effect.try({
    try: () => {
      const client = openDatabaseSync("wave.db");
      return {
        db: drizzle(client, { schema }),
        exec: (statements: string) => client.execSync(statements),
      };
    },
    catch: (cause) => new DatabaseError({ cause }),
  }),
);
