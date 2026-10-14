/**
 * What a Wave account syncs (docs/spec.md, "What syncs"), one table each:
 * the fields a row carries on the wire, how they're checked, and their
 * columns. Every table also has `account_id`, `id` and `change_no` (the
 * account's change number, which pulls page by). Rows that can be removed
 * also have `changed_at`, `phone_id` and `deleted` (Core's `SyncRow`) and
 * merge by Core's `mergeRows`; plays are only ever added (`mergePlays`).
 *
 * Adding a table or a field is a migration (`migrations.ts`) plus an entry here.
 */

import type { InValue } from "@libsql/client";
import type { SyncLimitName } from "./limits.ts";

type FieldType = "text" | "integer" | "boolean" | "json";

interface Field {
  readonly type: FieldType;
  /** Whether a live row may leave it `null`. */
  readonly nullable?: boolean;
  /** The only values a text field takes. */
  readonly values?: readonly string[];
}

export interface SyncTable {
  /** Its name on the wire (push and pull bodies). */
  readonly name: string;
  /** Its name in the database. */
  readonly sqlName: string;
  /** `rows`: merged by `mergeRows`, with tombstones. `plays`: added only, by `mergePlays`. */
  readonly kind: "rows" | "plays";
  /** The row's own fields, by wire name; each column is the name in snake case. */
  readonly fields: Readonly<Record<string, Field>>;
  /** The limit on how many rows (tombstones aside) an account holds. */
  readonly limit: SyncLimitName;
  /** A rule across fields a live row must keep, with what it says when broken. */
  readonly check?: (row: Readonly<Record<string, unknown>>) => string | null;
}

const text: Field = { type: "text" };
const nullableText: Field = { type: "text", nullable: true };
const integer: Field = { type: "integer" };
const nullableInteger: Field = { type: "integer", nullable: true };

export const SYNC_TABLES: readonly SyncTable[] = [
  {
    name: "songs",
    sqlName: "songs",
    kind: "rows",
    limit: "maxSongs",
    // The id is the song's recording key (Core's `recordingKey`).
    fields: {
      title: text,
      credit: text,
      album: nullableText,
      albumArtist: text,
      discNumber: nullableInteger,
      trackNumber: nullableInteger,
      durationMs: integer,
      year: nullableInteger,
      genre: nullableText,
      videoId: nullableText,
      addedAt: integer,
    },
  },
  {
    name: "playlists",
    sqlName: "playlists",
    kind: "rows",
    limit: "maxPlaylists",
    fields: { name: text, createdAt: integer },
  },
  {
    name: "playlistEntries",
    sqlName: "playlist_entries",
    kind: "rows",
    limit: "maxPlaylistEntries",
    // An entry holds a Library song (by recording key) or a YT Music song (as the app stores it), never both.
    fields: {
      playlistId: text,
      orderKey: text,
      songId: nullableText,
      ytSong: nullableText,
      addedAt: integer,
    },
    check: (row) =>
      (row.songId === null) === (row.ytSong === null) ? "needs songId or ytSong, not both" : null,
  },
  {
    name: "favorites",
    sqlName: "favorites",
    kind: "rows",
    limit: "maxFavorites",
    // The id is the song's recording key.
    fields: { addedAt: integer },
  },
  {
    name: "preferences",
    sqlName: "preferences",
    kind: "rows",
    limit: "maxPreferences",
    // The id is the preference's name; its value is any JSON.
    fields: { value: { type: "json" } },
  },
  {
    name: "plays",
    sqlName: "plays",
    kind: "plays",
    limit: "maxPlays",
    // Core's play event, its song known by recording key.
    fields: {
      songId: text,
      startedAt: integer,
      listenedMs: integer,
      durationMs: nullableInteger,
      endReason: { type: "text", values: ["completed", "skipped", "stopped", "interrupted"] },
      counted: { type: "boolean" },
      contextType: nullableText,
      contextId: nullableText,
      source: { type: "text", values: ["phone", "auto"] },
      importedFrom: { type: "text", nullable: true, values: ["blackplayer"] },
    },
  },
];

export const column = (field: string): string =>
  field.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** The longest id, text field or JSON value (as text) a row may carry. */
export const MAX_TEXT_LENGTH = 16_384;

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

const fieldValue = (field: Field, value: unknown, where: string): InValue => {
  if (value === null || value === undefined) {
    if (field.nullable === true) return null;
    throw new InvalidRow(`${where} is missing`);
  }
  switch (field.type) {
    case "text":
      if (!isText(value) || (field.values !== undefined && !field.values.includes(value))) {
        throw new InvalidRow(`${where} isn't valid text`);
      }
      return value;
    case "integer":
      if (!Number.isSafeInteger(value)) throw new InvalidRow(`${where} isn't an integer`);
      return value as number;
    case "boolean":
      if (typeof value !== "boolean") throw new InvalidRow(`${where} isn't a boolean`);
      return value ? 1 : 0;
    case "json": {
      const encoded = JSON.stringify(value);
      if (encoded.length > MAX_TEXT_LENGTH) throw new InvalidRow(`${where} is too long`);
      return encoded;
    }
  }
};

const rowValues = (table: SyncTable, row: Readonly<Record<string, unknown>>, where: string) => {
  const values = Object.entries(table.fields).map(([name, field]) =>
    fieldValue(field, row[name], `${where}.${name}`),
  );
  const broken = table.check?.(
    Object.fromEntries(Object.keys(table.fields).map((name, i) => [name, values[i] ?? null])),
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
  for (const [name, field] of Object.entries(table.fields)) {
    const value = row[column(name)] ?? null;
    if (value === null) out[name] = null;
    else if (field.type === "integer") out[name] = Number(value);
    else if (field.type === "boolean") out[name] = Number(value) === 1;
    else if (field.type === "json") out[name] = JSON.parse(String(value));
    else out[name] = value;
  }
  return out;
};
