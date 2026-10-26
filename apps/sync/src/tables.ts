/**
 * What a Wave account syncs (docs/spec.md, "What syncs"), one table each:
 * the fields a row carries on the wire, how they're checked, and their
 * columns. Every table also has `account_id`, `id` and `change_no` (the
 * account's change number, which pulls page by). Rows that can be removed
 * also have `changed_at`, `phone_id` and `deleted` (Core's `SyncRow`) and
 * merge by Core's `mergeRows`; plays are only ever added (`mergePlays`).
 *
 * The tables and their fields are Core's wire (`SYNC_TABLE_NAMES`,
 * `SYNC_FIELDS`, the same that `readPullPage` reads the app's pulls with);
 * only how each is kept and limited is the service's, below. Adding a table
 * or a field is a change to Core's wire, a migration (`migrations.ts`) and,
 * for a table, an entry in `STORAGE`.
 */

import type { InValue } from "@libsql/client";
import {
  SYNC_FIELDS,
  SYNC_TABLE_NAMES,
  type SyncFieldKind,
  type SyncTables,
  syncFieldFits,
} from "@wave/core";
import type { SyncLimitName } from "./limits.ts";

type TableName = keyof SyncTables;

/** How the service keeps a table: the part of it that isn't Core's wire. */
interface TableStorage {
  /** The limit on how many rows (tombstones aside) an account holds. */
  readonly limit: SyncLimitName;
  /** A rule across fields a live row must keep, with what it says when broken. */
  readonly check?: (row: Readonly<Record<string, unknown>>) => string | null;
  /** Fields whose column holds their value JSON-encoded. */
  readonly json?: readonly string[];
}

export interface SyncTable extends TableStorage {
  /** Its name on the wire (push and pull bodies). */
  readonly name: TableName;
  /** Its name in the database: its wire name in snake case. */
  readonly sqlName: string;
  /** `rows`: merged by `mergeRows`, with tombstones. `plays`: added only, by `mergePlays`. */
  readonly kind: "rows" | "plays";
  /** The row's own fields, by wire name (Core's `SYNC_FIELDS`); each column is the name in snake case. */
  readonly fields: Readonly<Record<string, SyncFieldKind>>;
}

const STORAGE: { readonly [K in TableName]: TableStorage } = {
  // The id is the song's recording key (Core's `recordingKey`).
  songs: { limit: "maxSongs" },
  playlists: { limit: "maxPlaylists" },
  // An entry holds a Library song (by recording key) or a YT Music song (as the app stores it), never both.
  playlistEntries: {
    limit: "maxPlaylistEntries",
    check: (row) =>
      (row.songId === null) === (row.ytSong === null) ? "needs songId or ytSong, not both" : null,
  },
  // The id is the song's recording key.
  favorites: { limit: "maxFavorites" },
  // The id is the preference's key. Its value was any JSON before Core's wire made it text,
  // so the column still holds it JSON-encoded.
  preferences: { limit: "maxPreferences", json: ["value"] },
  // Core's play event, its song known by recording key.
  plays: { limit: "maxPlays", json: ["snapshot"] },
};

export const column = (field: string): string =>
  field.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export const SYNC_TABLES: readonly SyncTable[] = SYNC_TABLE_NAMES.map((name) => ({
  name,
  sqlName: column(name),
  kind: name === "plays" ? "plays" : "rows",
  fields: SYNC_FIELDS[name],
  ...STORAGE[name],
}));

/** The longest id or text a row may carry. */
const MAX_TEXT_LENGTH = 16_384;

/** A pushed row, checked: `values` holds its fields in the table's order, or `null` for a tombstone. */
export interface IncomingRow {
  readonly id: string;
  readonly changedAt: number;
  readonly phoneId: string;
  readonly deleted: boolean;
  readonly values: readonly InValue[] | null;
}

/** Why a pushed row was refused, naming where it is (`songs[3].durationMs`). */
export class InvalidRow extends Error {}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_TEXT_LENGTH;

/** What a value that doesn't fit a field of [kind] isn't. */
const misfit = (kind: SyncFieldKind): string => {
  if (typeof kind !== "string") return "one of its values";
  if (kind.startsWith("int")) return "an integer";
  if (kind === "snapshot?") return "a play snapshot";
  return kind === "bool" ? "a boolean" : "text";
};

/** A pushed field's [value], checked against its [kind], as its column holds it. */
const fieldValue = (kind: SyncFieldKind, json: boolean, value: unknown, where: string): InValue => {
  const given = value ?? null;
  if (!syncFieldFits(kind, given)) {
    throw new InvalidRow(`${where} ${given === null ? "is missing" : `isn't ${misfit(kind)}`}`);
  }
  if (typeof given === "string" && given.length > MAX_TEXT_LENGTH) {
    throw new InvalidRow(`${where} is too long`);
  }
  if (kind === "snapshot?" && isRecord(given)) {
    for (const [name, snapshotValue] of Object.entries(given)) {
      if (typeof snapshotValue === "string" && snapshotValue.length > MAX_TEXT_LENGTH) {
        throw new InvalidRow(`${where}.${name} is too long`);
      }
    }
  }
  if (given === null) return null;
  if (json) return JSON.stringify(given);
  return typeof given === "boolean" ? (given ? 1 : 0) : (given as InValue);
};

const rowValues = (table: SyncTable, row: Readonly<Record<string, unknown>>, where: string) => {
  const values = Object.entries(table.fields).map(([name, kind]) =>
    fieldValue(kind, table.json?.includes(name) === true, row[name], `${where}.${name}`),
  );
  const broken = table.check?.(
    Object.fromEntries(Object.keys(table.fields).map((name) => [name, row[name] ?? null])),
  );
  if (broken !== undefined && broken !== null) throw new InvalidRow(`${where} ${broken}`);
  return values;
};

/** Checks a pushed row of [table] at [where]; throws `InvalidRow` when it isn't one. */
export const parseRow = (table: SyncTable, row: unknown, where: string): IncomingRow => {
  if (!isRecord(row)) throw new InvalidRow(`${where} isn't an object`);
  if (!isText(row.id) || row.id === "") throw new InvalidRow(`${where}.id isn't valid`);
  if (table.kind === "plays") {
    return {
      id: row.id,
      changedAt: 0,
      phoneId: "",
      deleted: false,
      values: rowValues(table, row, where),
    };
  }
  if (!Number.isSafeInteger(row.changedAt)) throw new InvalidRow(`${where}.changedAt isn't valid`);
  if (!isText(row.phoneId) || row.phoneId === "") {
    throw new InvalidRow(`${where}.phoneId isn't valid`);
  }
  if (typeof row.deleted !== "boolean") throw new InvalidRow(`${where}.deleted isn't a boolean`);
  return {
    id: row.id,
    changedAt: row.changedAt as number,
    phoneId: row.phoneId,
    deleted: row.deleted,
    values: row.deleted ? null : rowValues(table, row, where),
  };
};

/** A stored row as a pull answers it: a tombstone carries no fields. */
export const wireRow = (
  table: SyncTable,
  row: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const out: Record<string, unknown> = { id: row.id };
  if (table.kind === "rows") {
    out.changedAt = Number(row.changed_at);
    out.phoneId = row.phone_id;
    out.deleted = Number(row.deleted) === 1;
    if (out.deleted) return out;
  }
  for (const [name, kind] of Object.entries(table.fields)) {
    const value = row[column(name)] ?? null;
    if (value === null) out[name] = null;
    else if (table.json?.includes(name) === true) out[name] = JSON.parse(String(value));
    else if (kind === "int" || kind === "int?") out[name] = Number(value);
    else if (kind === "bool") out[name] = Number(value) === 1;
    else out[name] = value;
  }
  return out;
};
