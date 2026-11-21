/**
 * The desktop's sync with the Wave account (docs/spec-desktop.md, Wave account and sync): the
 * phone's sync cycle (`@wave/client/sync/syncCycle`) over the desktop's Library, timed by
 * Core's `syncTriggers`. It pulls on opening signed in and at sign-in, on focus once the last
 * sync is 5 minutes old and every 15 minutes, and pushes a few seconds after a play ends or
 * something changes. Signing out leaves the account: the account's missing songs go, the
 * desktop's own files and plays stay.
 */
import { creditSplits } from "@wave/client/db/credits";
import type { LibraryDatabase } from "@wave/client/db/database";
import { signOut } from "@wave/client/db/missingSongs";
import { selectJoinedAccount } from "@wave/client/db/syncRows";
import { collaborationService } from "@wave/client/sync/collaborationService";
import { syncCycle, type SyncedChanges } from "@wave/client/sync/syncCycle";
import {
  DESKTOP_SYNC_PERIOD_MS,
  desktopUsesPreference,
  SYSTEM_SYNC_CLOCK,
  syncTriggers,
  type SyncClock,
  type SyncTriggers,
  type WaveSession,
} from "@wave/core";
import { sql } from "drizzle-orm";
import type { WaveAccountService } from "../account/account.ts";

export interface DesktopSyncDeps {
  readonly db: LibraryDatabase;
  readonly account: Pick<WaveAccountService, "session" | "subscribe" | "request">;
  /** The time and timers; the system's by default. */
  readonly clock?: SyncClock;
  /** Whether a Wave window has focus: a play's end then goes up within seconds. */
  readonly focused: () => boolean;
  /** Waits [ms] when the service asks to slow down. */
  readonly wait?: (ms: number) => Promise<void>;
  /** Where a sync that failed for an unexpected reason is told; console.warn by default. */
  readonly log?: (message: string, error: unknown) => void;
  /** A sync pulled new values for the synced settings [keys], already kept. */
  readonly preferencesPulled?: (keys: readonly string[]) => void;
  /** A sync pulled stars or songs: a star of a missing song may ask for its download. */
  readonly starsPulled?: () => void;
}

export interface DesktopSync {
  /** Follows the account: syncs now when signed in. */
  readonly start: () => void;
  /** A window got focus. */
  readonly foreground: () => void;
  /** The Library changed here: a scan ([songs]), a star, a playlist. */
  readonly edited: (what: { readonly songs: boolean }) => void;
  readonly played: (step: "started" | "ended") => void;
  /** Goes up whenever the account changed the Library: the window reads its lists again. */
  readonly revision: () => number;
  /** Resolves once no sync runs. */
  readonly idle: () => Promise<void>;
  /** Stops timing syncs; one running finishes, or fails quietly as the Library closes. */
  readonly dispose: () => void;
}

/** Offline, signed out or the session ended: Settings › Accounts says so, the log needn't. */
const EXPECTED = new Set(["ERR_WAVE_OFFLINE", "ERR_WAVE_SIGNED_OUT", "ERR_WAVE_SESSION_ENDED"]);

/**
 * The value the account holds for the synced setting [key], if the desktop uses it. The
 * phone's own UI settings (Core's `desktopUsesPreference`) are kept but never read here.
 */
export const syncedPreference = (db: LibraryDatabase, key: string): string | null =>
  desktopUsesPreference(key) ? storedPreference(db, key) : null;

const storedPreference = (db: LibraryDatabase, key: string): string | null =>
  db.get<{ value: string }>(sql`SELECT value FROM desktop_synced_preferences WHERE key = ${key}`)
    ?.value ?? null;

/** Every synced value is kept, so joining the account again pushes what it held. */
export const keepPreference = (db: LibraryDatabase, key: string, value: string | null): void => {
  if (value === null) db.run(sql`DELETE FROM desktop_synced_preferences WHERE key = ${key}`);
  else
    db.run(
      sql`INSERT INTO desktop_synced_preferences (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
};

const changedAnything = (pulled: SyncedChanges): boolean =>
  pulled.songs ||
  pulled.library ||
  pulled.playlists ||
  pulled.favorites ||
  pulled.plays ||
  pulled.follows ||
  pulled.dismissedSuggestions ||
  pulled.dislikes ||
  pulled.preferences.length > 0;

export const createDesktopSync = (deps: DesktopSyncDeps): DesktopSync => {
  const { db, account } = deps;
  const clock = deps.clock ?? SYSTEM_SYNC_CLOCK;
  const log = deps.log ?? ((message, error) => console.warn(message, error));
  const splits = creditSplits();
  /** The account signed in (its email), or null. */
  let email: string | null = null;
  let revision = 0;
  let running: Promise<boolean> | null = null;
  let unsubscribe: (() => void) | null = null;
  /** Wave is quitting: a sync cut short by the Library closing isn't news. */
  let disposed = false;

  /** Leaves the account if the Library is still joined with one. */
  const leave = (): void => {
    if (selectJoinedAccount(db) === null) return;
    signOut(db, splits);
    revision++;
  };

  const syncOnce = async (songs: boolean, signedIn: string): Promise<boolean> => {
    try {
      const { pulled } = await syncCycle({
        db,
        splits,
        transport: account,
        preferences: {
          value: (key) => storedPreference(db, key),
          apply: (key, value) => keepPreference(db, key, value),
        },
        account: signedIn,
        now: clock.now,
        songsChanged: songs,
        wait: deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
        historyChanged: () => void revision++,
        // The desktop shows collaborative playlists and edits none: it pulls each one and
        // pushes nothing of them (docs/spec-desktop.md, Wave account and sync).
        collaboration: collaborationService(account),
        pushCollaborative: false,
      });
      if (changedAnything(pulled)) revision++;
      if (pulled.preferences.length > 0)
        deps.preferencesPulled?.(pulled.preferences.map(({ key }) => key));
      if (pulled.favorites || pulled.songs || pulled.library) deps.starsPulled?.();
      return true;
    } catch (error) {
      if (disposed) return false;
      const code = (error as { code?: unknown; cause?: { code?: unknown } }).code;
      const causeCode = (error as { cause?: { code?: unknown } }).cause?.code;
      if (!EXPECTED.has(String(code)) && !EXPECTED.has(String(causeCode)))
        log("[wave] Syncing with the Wave account didn't finish", error);
      return false;
    } finally {
      // Signed out while it ran: what it joined goes too.
      if (email === null && !disposed) leave();
    }
  };

  const run = (songs: boolean): Promise<boolean> => {
    if (email === null) return Promise.resolve(false);
    const current = syncOnce(songs, email);
    running = current;
    void current.finally(() => {
      if (running === current) running = null;
    });
    return current;
  };

  /** Made at the first sign-in: signed out, nothing times a sync. */
  let triggers: SyncTriggers | null = null;
  const signedInTriggers = (): SyncTriggers =>
    (triggers ??= syncTriggers({
      clock,
      inForeground: deps.focused,
      run,
      // The first sync after opening looks at the song list.
      songsChanged: true,
      everyMs: DESKTOP_SYNC_PERIOD_MS,
    }));

  const sessionChanged = (session: WaveSession): void => {
    if (session.status === "signedIn") {
      const changed = email !== session.account.email;
      email = session.account.email;
      if (changed) signedInTriggers().now();
      return;
    }
    email = null;
    triggers?.stop();
    leave();
  };

  return {
    start: () => {
      if (unsubscribe !== null) return;
      unsubscribe = account.subscribe(sessionChanged);
      sessionChanged(account.session());
    },
    foreground: () => {
      if (email !== null) signedInTriggers().foreground();
    },
    edited: (what) => {
      if (email !== null) signedInTriggers().edited(what);
    },
    played: (step) => {
      if (email !== null) signedInTriggers().played(step);
    },
    revision: () => revision,
    idle: async () => {
      // A sync can ask for another as it ends: wait for that one too.
      while (running !== null) {
        await running;
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    dispose: () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      triggers?.stop();
    },
  };
};
