/**
 * One sync with the Wave account (docs/spec.md, "Wave account and sync"):
 * pull what changed on the account, bring the song list up to date, push
 * what changed here in batches the service takes, and pull again after a
 * push. The store does the translating and the merging (`db/syncRows.ts`);
 * this drives it through the service. Kept free of Expo and React Native so
 * the store tests run it against a fake service (`testSyncService.ts`).
 */
import {
  finishSteps,
  pushBatches,
  pushBody,
  readPullMembership,
  readPullPage,
  readPushAnswer,
  refusalEndsMembership,
  type CollaborationResult,
  type PullMembership,
  type SliceResult,
  type SyncPullPage,
  type SyncPushAnswer,
  type SyncTables,
} from "@wave/core";

import {
  applyMembership,
  makePrivateCopy,
  selectCollaborations,
  selectMemberPlaylists,
} from "../db/collaborations.ts";
import type { CreditSplits } from "../db/credits.ts";
import type { LibraryDatabase } from "../db/database.ts";
import { syncMissingSongsSteps } from "../db/missingSongs.ts";
import {
  applyPendingSteps,
  applyPlaylistPage,
  applyPulledPageSteps,
  joinAccount,
  markPushedSteps,
  planSongsSteps,
  pushMarkKey,
  selectJoinedAccount,
  selectSyncCursor,
  selectUnpushedPlaylist,
  selectUnpushedSteps,
  type PulledChanges,
  type PushMark,
  type UnpushedRows,
} from "../db/syncRows.ts";
import type { CollaborationService } from "./collaborationService.ts";

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
  /** Called after a committed page adds listening, even if a later network request fails. */
  readonly historyChanged?: () => void;
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
  /**
   * Resolves when the app has a free turn (Core's `BackgroundWork`): each
   * synchronous database step (joining, a pulled page, settling, a push's
   * reads and marks) waits for one, so a sync never holds the JavaScript
   * thread while the owner taps. Absent: no wait.
   */
  readonly turn?: () => Promise<void>;
  /**
   * Runs [steps] for one of the app's background slices (`lib/stepped.ts`) and says whether
   * they finished. Given, each database step above runs a slice at a time, with a free turn
   * before each, so none holds the JavaScript thread for long. Absent, each runs whole.
   */
  readonly slice?: <A>(steps: Iterator<void, A>) => SliceResult<A>;
  /**
   * The collaborative playlists' requests (`collaborationService`), which the phone and the
   * computer always give: each cycle then keeps the account's collaborative playlists as its
   * pull states them, and syncs each one the account doesn't own with its own pull and push.
   * Absent (a test's sync): nothing of them changes.
   */
  readonly collaboration?: CollaborationService;
  /** A member's changes go up (the phone); false only pulls them (the desktop). Default true. */
  readonly pushCollaborative?: boolean;
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
class SyncRequestFailed extends Error {
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
class SyncSignedOut extends Error {
  readonly code = "ERR_WAVE_SIGNED_OUT";
  constructor() {
    super("Signed out of the Wave account during a sync");
  }
}

/**
 * Rows read per table at a time, so a first push of a large history never sits in memory whole:
 * about a push's worth (`SYNC_PUSH_BATCH`), so cutting them into pushes stays short too.
 */
const READ_AT_ONCE = 1_000;
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

/**
 * Waits for the app's free turn before a database step; signed out
 * meanwhile, the sync stops there, as it does when an answer comes back.
 */
const freeTurn = async (input: SyncCycleInput): Promise<void> => {
  if (input.turn === undefined) return;
  await input.turn();
  if (selectJoinedAccount(input.db) !== input.account) throw new SyncSignedOut();
};

/**
 * Runs the database [steps] after the app's free turn: a slice at a time, with a free turn
 * before each, when the app gives slices (`slice`), else whole. Signed out meanwhile, the
 * sync stops before the next slice.
 */
const inTurns = async <A>(input: SyncCycleInput, steps: Generator<void, A>): Promise<A> => {
  try {
    for (;;) {
      await freeTurn(input);
      if (input.slice === undefined) return finishSteps(steps);
      const slice = input.slice(steps);
      if (slice.done) return slice.value;
    }
  } finally {
    steps.return(undefined as A);
  }
};

interface Seen {
  songs: boolean;
  library: boolean;
  playlists: boolean;
  favorites: boolean;
  plays: boolean;
  follows: boolean;
  dismissedSuggestions: boolean;
  dislikes: boolean;
  preferences: { key: string; value: string | null }[];
}

const nothingSeen = (): Seen => ({
  songs: false,
  library: false,
  playlists: false,
  favorites: false,
  plays: false,
  follows: false,
  dismissedSuggestions: false,
  dislikes: false,
  preferences: [],
});

const take = (seen: Seen, changes: PulledChanges): void => {
  seen.songs ||= changes.songs;
  seen.playlists ||= changes.playlists;
  seen.favorites ||= changes.favorites;
  seen.plays ||= changes.plays;
  seen.follows ||= changes.follows;
  seen.dismissedSuggestions ||= changes.dismissedSuggestions;
  seen.dislikes ||= changes.dislikes;
  seen.preferences.push(...changes.preferences);
};

/** The account's collaborative playlists as a pull page states them (`applyMembership`). */
const keepMembership = (input: SyncCycleInput, seen: Seen, membership: PullMembership): void => {
  seen.playlists ||= applyMembership(input.db, membership);
};

/**
 * Runs the database steps [run] makes in turns (`inTurns`), taking what each of their pieces
 * changed into [seen]. Once they end, or stop part way, the history hears of new listening
 * once and the preferences the account changed are applied.
 */
const applying = async (
  input: SyncCycleInput,
  seen: Seen,
  run: (applied: (changes: PulledChanges) => void) => Generator<void, void>,
): Promise<void> => {
  let plays = false;
  const preferences: { key: string; value: string | null }[] = [];
  try {
    await inTurns(
      input,
      run((changes) => {
        take(seen, changes);
        plays ||= changes.plays;
        preferences.push(...changes.preferences);
      }),
    );
  } finally {
    if (plays) input.historyChanged?.();
    for (const { key, value } of preferences) input.preferences.apply(key, value);
  }
};

/** A pulled [page] applied in steps: the collaborative playlists its [body] states, then its rows. */
function* pageSteps(
  input: SyncCycleInput,
  seen: Seen,
  body: string,
  page: SyncPullPage,
  applied: (changes: PulledChanges) => void,
): Generator<void, void> {
  // Before the page's rows, so a collaborative playlist's entries find their songs by their fields.
  const membership = input.collaboration === undefined ? null : readPullMembership(body);
  if (membership !== null) {
    keepMembership(input, seen, membership);
    yield;
  }
  yield* applyPulledPageSteps(input.db, page, input.now(), applied);
}

/** Pulls every page changed after the cursor kept, applying each; true when any row came. */
const pullAll = async (input: SyncCycleInput, seen: Seen): Promise<boolean> => {
  const { db } = input;
  let pulledAny = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const since = encodeURIComponent(selectSyncCursor(db) ?? "0");
    const body = await send(input, "GET", `/v1/pull?since=${since}`, null);
    const page = readPullPage(body);
    if (page === null) throw new SyncRequestFailed(200, "not a pull page");
    await applying(input, seen, (applied) => pageSteps(input, seen, body, page, applied));
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
  what: { pulled: boolean; songs: boolean; plan: boolean },
): Promise<void> => applying(input, seen, (applied) => settleSteps(input, seen, what, applied));

function* settleSteps(
  input: SyncCycleInput,
  seen: Seen,
  { pulled, songs, plan }: { pulled: boolean; songs: boolean; plan: boolean },
  applied: (changes: PulledChanges) => void,
): Generator<void, void> {
  const { db } = input;
  if (songs) {
    if (plan) {
      yield* planSongsSteps(db, input.now());
      yield;
    }
    seen.library ||= yield* syncMissingSongsSteps(db, input.splits, input.now());
    yield;
  }
  if (pulled || songs) yield* applyPendingSteps(db, input.now(), applied);
}

const rowCount = (rows: SyncTables): number =>
  Object.values(rows).reduce((sum: number, table: readonly unknown[]) => sum + table.length, 0);

/** Marks the rows of [unpushed] a push of [batch] took, with the change times the service stored. */
function* markBatchSteps(
  db: LibraryDatabase,
  unpushed: UnpushedRows,
  batch: SyncTables,
  answer: SyncPushAnswer,
): Generator<void, void> {
  const storedAt = new Map<PushMark, number>();
  for (const { table, id, changedAt } of answer.corrected) {
    for (const mark of unpushed.marks.get(pushMarkKey(table, id)) ?? []) {
      storedAt.set(mark, changedAt);
    }
  }
  yield* markPushedSteps(
    db,
    (Object.keys(batch) as (keyof SyncTables)[]).flatMap((table) =>
      batch[table].flatMap((row) => unpushed.marks.get(pushMarkKey(table, row.id)) ?? []),
    ),
    storedAt,
  );
}

/**
 * Pushes every row that waits, in batches; each batch is marked as soon as
 * the service has it, with the change time the service stored for a row
 * whose own was ahead of its clock.
 */
const pushAll = async (input: SyncCycleInput): Promise<number> => {
  const { db } = input;
  let pushed = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const unpushed = await inTurns(
      input,
      selectUnpushedSteps(db, READ_AT_ONCE, input.preferences.value),
    );
    if (rowCount(unpushed.rows) === 0) break;
    for (const batch of pushBatches(unpushed.rows)) {
      const answer = readPushAnswer(await send(input, "POST", "/v1/push", pushBody(batch)));
      await inTurns(input, markBatchSteps(db, unpushed, batch, answer));
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
  // Not joined yet: no account to check after this turn.
  await input.turn?.();
  const joined = joinAccount(input.db, input.account);
  const seen = nothingSeen();
  const pulled = await pullAll(input, seen);
  await settle(input, seen, {
    pulled,
    songs: joined || input.songsChanged || seen.songs,
    plan: true,
  });
  let pushed = await pushAll(input);
  if (pushed > 0) {
    const songsBefore = seen.songs;
    seen.songs = false;
    const again = await pullAll(input, seen);
    await settle(input, seen, { pulled: again, songs: seen.songs, plan: false });
    seen.songs ||= songsBefore;
  }
  if (input.collaboration !== undefined) {
    let copied = false;
    for (const { syncId } of selectMemberPlaylists(input.db)) {
      if ((await syncMemberPlaylist(input, input.collaboration, seen, syncId)) === "ended")
        copied = true;
    }
    // A private copy is a playlist of the account's own: it goes up in this cycle.
    if (copied) pushed += await pushAll(input);
  }
  return { pulled: seen, pushed };
};

/**
 * Syncs the collaborative playlist [playlistId] alone, while its page is in sight (docs/spec.md,
 * "Collaborative playlists", Refreshing): a member's device pulls it with its own requests,
 * pushes what waits in it and pulls again after a push. When the service says the member is no
 * longer in it, the account pull says why first: left, it goes from the device; else it becomes
 * a private copy, pushed at once as a cycle does. The owner's device pulls the account,
 * which holds the playlist's rows. Nothing is sent for an ordinary playlist, without
 * [collaboration], or before the Library joined the account.
 */
export const syncCollaborativePlaylist = async (
  input: SyncCycleInput,
  playlistId: number,
): Promise<SyncCycleResult> => {
  const seen = nothingSeen();
  const service = input.collaboration;
  if (service === undefined) return { pulled: seen, pushed: 0 };
  await input.turn?.();
  if (selectJoinedAccount(input.db) !== input.account) return { pulled: seen, pushed: 0 };
  const held = selectCollaborations(input.db).find((each) => each.playlistId === playlistId);
  if (held === undefined) return { pulled: seen, pushed: 0 };
  if (held.owned) {
    const pulled = await pullAll(input, seen);
    await settle(input, seen, { pulled, songs: seen.songs, plan: false });
    return { pulled: seen, pushed: 0 };
  }
  const step = await syncMemberPlaylist(input, service, seen, held.syncId, false);
  if (step === "refused") {
    // Left on another device, or ended: only the account pull tells which (`applyMembership`).
    const pulled = await pullAll(input, seen);
    await settle(input, seen, { pulled, songs: seen.songs, plan: false });
    return { pulled: seen, pushed: await pushAll(input) };
  }
  return { pulled: seen, pushed: step === "ended" ? await pushAll(input) : 0 };
};

/**
 * How a member's requests of one playlist went: on, stopped until the next cycle, ended, or
 * refused as no longer the account's with no private copy made, for the account pull to settle.
 */
type MemberStep = "done" | "stopped" | "ended" | "refused";

/**
 * What a collaboration request came to for the cycle. Signed out meanwhile stops the whole
 * sync, as an account request does; a refusal that ends the membership (Core's
 * `refusalEndsMembership`) keeps the playlist as the member's private copy when [copy], and
 * is "refused" otherwise; any other refusal or failure stops only this playlist, its changes
 * still waiting.
 */
const memberStep = <T>(
  input: SyncCycleInput,
  seen: Seen,
  syncId: string,
  copy: boolean,
  result: CollaborationResult<T>,
): { readonly value: T } | MemberStep => {
  if (selectJoinedAccount(input.db) !== input.account) throw new SyncSignedOut();
  if (result.type === "done") return { value: result.value };
  if (result.type === "refused" && refusalEndsMembership(result.refusal)) {
    if (!copy) return "refused";
    makePrivateCopy(input.db, syncId);
    seen.playlists = true;
    return "ended";
  }
  return "stopped";
};

/** Pulls every page of the member's playlist [syncId] after its own cursor. */
const pullMemberPlaylist = async (
  input: SyncCycleInput,
  service: CollaborationService,
  seen: Seen,
  syncId: string,
  copy: boolean,
): Promise<MemberStep> => {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const cursor =
      selectMemberPlaylists(input.db).find((each) => each.syncId === syncId)?.cursor ?? null;
    const step = memberStep(input, seen, syncId, copy, await service.pull(syncId, cursor));
    if (typeof step === "string") return step;
    await freeTurn(input);
    const page = step.value;
    const applied = applyPlaylistPage(input.db, syncId, page, input.now());
    if (applied.deleted) {
      // The owner deleted it: what the member had stays theirs.
      makePrivateCopy(input.db, syncId);
      seen.playlists = true;
      return "ended";
    }
    seen.playlists ||= applied.changed;
    if (!page.more) break;
  }
  return "done";
};

/** Pushes the member's changes to the playlist [syncId]. */
const pushMemberPlaylist = async (
  input: SyncCycleInput,
  service: CollaborationService,
  seen: Seen,
  syncId: string,
  copy: boolean,
): Promise<MemberStep | "pushed"> => {
  let pushed = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    await freeTurn(input);
    const unpushed = selectUnpushedPlaylist(input.db, syncId, READ_AT_ONCE);
    if (rowCount(unpushed.rows) === 0) break;
    for (const batch of pushBatches(unpushed.rows)) {
      const step = memberStep(
        input,
        seen,
        syncId,
        copy,
        await service.push(syncId, pushBody(batch)),
      );
      if (typeof step === "string") return step;
      await inTurns(input, markBatchSteps(input.db, unpushed, batch, step.value));
      pushed = true;
    }
  }
  return pushed ? "pushed" : "done";
};

/**
 * Syncs the collaborative playlist [syncId] of another account: pulls what changed after its
 * own cursor, pushes what the member changed here, and pulls again after a push. A refusal or
 * a failure stops this playlist only (`memberStep`); [copy] says whether a refusal that ends the
 * membership makes the private copy here (the cycle, whose account pull just ran) or is left
 * to the account pull (the page's).
 */
const syncMemberPlaylist = async (
  input: SyncCycleInput,
  service: CollaborationService,
  seen: Seen,
  syncId: string,
  copy = true,
): Promise<MemberStep> => {
  const pulled = await pullMemberPlaylist(input, service, seen, syncId, copy);
  if (pulled !== "done" || input.pushCollaborative === false) return pulled;
  const pushed = await pushMemberPlaylist(input, service, seen, syncId, copy);
  if (pushed !== "pushed") return pushed;
  return pullMemberPlaylist(input, service, seen, syncId, copy);
};
