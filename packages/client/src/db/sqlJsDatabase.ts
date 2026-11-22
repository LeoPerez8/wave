/**
 * An in-memory SQLite (sql.js, compiled to WebAssembly) for plain Node: the store tests, the
 * desktop benches and the reference database a perf run seeds.
 */
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs from "sql.js";

import { configureConnection } from "./connection.ts";
import * as schema from "./schema.ts";

/**
 * Opens a database holding [image], or an empty one, set up as the phone sets up its own
 * connection; not migrated. Its sql.js client is how to export or close it.
 */
export const openSqlJsDatabase = async (image?: Uint8Array) => {
  const SQL = await initSqlJs();
  const client = new SQL.Database(image);
  // As on the phone (cascades only happen with foreign keys on).
  configureConnection((statements) => client.exec(statements));
  return { client, db: drizzle(client, { schema }) };
};
