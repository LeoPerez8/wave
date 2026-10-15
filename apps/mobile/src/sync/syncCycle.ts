/**
 * One sync with the Wave account (docs/spec.md, "Wave account and sync"):
 * pull what changed on the account, bring the song list up to date, push
 * what changed here in batches the service takes, and pull again after a
 * push. The store does the translating and the merging (`db/syncRows.ts`);
 * this drives it through the service. Kept free of Expo and React Native so
 * the store tests run it against a fake service (`testSyncService.ts`).
 */
import { pushBatches, readPullPage, type SyncTables } from "@wave/core";

import type { CreditSplits } from "../library/db/credits.ts";
import type { LibraryDatabase } from "../library/db/database.ts";
import { syncMissingSongs } from "../library/db/missingSongs.ts";
import {
  applyPending,
  applyPulledPage,
  joinAccount,
  markPushed,
  planSongs,
  pushMarkKey,
  selectAccountTrackIds,
  selectJoinedAccount,
  selectSyncCursor,
  selectUnpushed,
  type PulledChanges,
} from "../library/db/syncRows.ts";

/** Sends a push or a pull with the session (`WaveAccount.request`). */
export interface SyncTransport {
  readonly request: (
    method: "GET" | "POST",
    path: string,
    body: string | null,
  ) => Promise<{ readonly status: number; readonly body: string }>;
}

/** The synced preferences' values, which live outside the store (the key-value store). */
export interface SyncPreferences {
  /** What the key-value store holds for [key] (null: nothing, its default). */
  readonly value: (key: string) => string | null;
  /** Applies a value from the account: stored and shown at once, not stamped as a change made here. */
  readonly apply: (key: string, value: string | null) => void;
}

export interface SyncCycleInput {
  readonly db: LibraryDatabase;
  /** The store's credit splitter, which missing songs are filed with. */
  readonly splits: CreditSplits;
  readonly transport: SyncTransport;
  readonly preferences: SyncPreferences;
  /** The account signed in (its email): the Library is joined with it (`joinAccount`). */
  readonly account: string;
  readonly now: () => number;
  /** Whether the Library's songs may have changed since the last sync (a scan, a download). */
  readonly songsChanged: boolean;
  /** Waits [ms]; the service is asked again after a while when it refuses for the request rate. */
  readonly wait: (ms: number) => Promise<void>;
}

/** What a sync changed on the phone. */
export interface SyncedChanges extends PulledChanges {
  /** Missing songs came in, changed or left: the Library's lists read again. */
  readonly library: boolean;
}

export interface SyncCycleResult {
  /** What the account's changes changed on the phone. */
  readonly pulled: SyncedChanges;
  /** How many rows went up. */
  readonly pushed: number;
}

/** The service answered something other than success. */
export class SyncRequestFailed extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`The sync service answered ${status}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

/**
 * The Library left the account (signed out) while a request was on its way:
 * the sync stops there, and what the answer brought isn't applied. Its code
 * is the one the native module rejects a request made signed out with.
 */
export class SyncSignedOut extends Error {
  readonly code = "ERR_WAVE_SIGNED_OUT";
  constructor() {
    super("Signed out of the Wave account during a sync");
  }
}

/** Rows read per table at a time, so a first push of a large history never sits in memory whole. */
const READ_AT_ONCE = 5_000;
/** How long to wait when the service refuses for the request rate (its window is a minute). */
const RATE_WAIT_MS = 20_000;
/** How many times a request refused for the rate is sent again before the sync gives up. */
const RATE_RETRIES = 4;
/** How many pages or reads one sync goes through at most, should something never settle. */
const MAX_ROUNDS = 10_000;

const send = async (
  input: SyncCycleInput,
  method: "GET" | "POST",
  path: string,
  body: string | null,
): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const response = await input.transport.request(method, path, body);
    if (selectJoinedAccount(input.db) !== input.account) throw new SyncSignedOut();
    if (response.status === 429 && attempt < RATE_RETRIES) {
      await input.wait(RATE_WAIT_MS);
      continue;
    }
    if (response.status < 200 || response.status > 299) {
      throw new SyncRequestFailed(response.status, response.body);
    }
    return response.body;
  }
};

interface Seen {
  songs: boolean;
  library: boolean;
  playlists: boolean;
  favorites: boolean;
  plays: boolean;
  preferences: { key: string; value: string | null }[];
}

const take = (seen: Seen, changes: PulledChanges): void => {
  seen.songs ||= changes.songs;
  seen.playlists ||= changes.playlists;
  seen.favorites ||= changes.favorites;
  seen.plays ||= changes.plays;
  seen.preferences.push(...changes.preferences);
};

/** Pulls every page changed after the cursor kept, applying each; true when any row came. */
const pullAll = async (input: SyncCycleInput, seen: Seen): Promise<boolean> => {
  const { db } = input;
  const trackIds = selectAccountTrackIds(db);
  let pulledAny = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const since = encodeURIComponent(selectSyncCursor(db) ?? "0");
    const page = readPullPage(await send(input, "GET", `/v1/pull?since=${since}`, null));
    if (page === null) throw new SyncRequestFailed(200, "not a pull page");
    const changes = applyPulledPage(db, page, trackIds, input.now());
    take(seen, changes);
    for (const { key, value } of changes.preferences) input.preferences.apply(key, value);
    pulledAny ||= Object.values(page).some((rows) => Array.isArray(rows) && rows.length > 0);
    if (!page.more) break;
  }
  return pulledAny;
};

/**
 * After a pull: when the songs may have changed, brings the account's song
 * list up to date with the phone's ([plan]: before a push) and the Library's
 * missing songs with the account's (`syncMissingSongs`); then places the
 * rows that waited for a song or a playlist the phone now has.
 */
const settle = (
  input: SyncCycleInput,
  seen: Seen,
  { pulled, songs, plan }: { pulled: boolean; songs: boolean; plan: boolean },
): void => {
  const { db } = input;
  if (songs) {
    if (plan) planSongs(db, input.now());
    seen.library ||= syncMissingSongs(db, input.splits, input.now());
  }
  if (pulled || songs) take(seen, applyPending(db, selectAccountTrackIds(db)));
};

const rowCount = (rows: SyncTables): number =>
  Object.values(rows).reduce((sum: number, table: readonly unknown[]) => sum + table.length, 0);

/** Pushes every row that waits, in batches; each batch is marked as soon as the service has it. */
const pushAll = async (input: SyncCycleInput): Promise<number> => {
  const { db } = input;
  let pushed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const unpushed = selectUnpushed(db, READ_AT_ONCE, input.preferences.value);
    if (rowCount(unpushed.rows) === 0) break;
    for (const batch of pushBatches(unpushed.rows)) {
      await send(input, "POST", "/v1/push", JSON.stringify(batch));
      markPushed(
        db,
        (Object.keys(batch) as (keyof SyncTables)[]).flatMap((table) =>
          batch[table].flatMap((row) => unpushed.marks.get(pushMarkKey(table, row.id)) ?? []),
        ),
      );
      pushed += rowCount(batch);
    }
  }
  return pushed;
};

/**
 * Syncs the Library with the account: joins it first if it isn't yet (a
 * sign-in), pulls, brings the song lists up to date when the songs may have
 * changed (the account's with the phone's files, the Library's missing songs
 * with the account's), pushes, and pulls again after a push. A failed
 * request stops it where it is (it throws): what was pulled or pushed by
 * then stays done, and the next sync goes on from there. Signing out stops
 * it too (`SyncSignedOut`), before the answer on its way is applied.
 */
export const syncCycle = async (input: SyncCycleInput): Promise<SyncCycleResult> => {
  const joined = joinAccount(input.db, input.account);
  const seen: Seen = {
    songs: false,
    library: false,
    playlists: false,
    favorites: false,
    plays: false,
    preferences: [],
  };
  const pulled = await pullAll(input, seen);
  settle(input, seen, { pulled, songs: joined || input.songsChanged || seen.songs, plan: true });
  const pushed = await pushAll(input);
  if (pushed > 0) {
    const songsBefore = seen.songs;
    seen.songs = false;
    const again = await pullAll(input, seen);
    settle(input, seen, { pulled: again, songs: seen.songs, plan: false });
    seen.songs ||= songsBefore;
  }
  return { pulled: seen, pushed };
};
