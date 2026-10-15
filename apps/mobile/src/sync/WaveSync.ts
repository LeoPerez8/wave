import type { WaveSession } from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppState } from "react-native";

import { LibraryStore } from "@/library/LibraryStore";
import type { PulledChanges } from "@/library/db/syncRows";
import { WaveAccount, waveAccountErrorCode } from "@/native/waveAccount";

import type { SyncPreferences } from "./syncCycle";

/** How long a push waits after the last change, so a run of edits goes up as one. */
const PUSH_DELAY_MS = 3_000;

/** What syncing needs from the app that only the app (not a headless start) has. */
export interface WaveSyncPorts {
  /** The synced preferences' values (`syncedPreferences`). */
  readonly preferences: SyncPreferences;
  /** Hears what each sync changed on the phone, to show it. */
  readonly pulled: (changes: PulledChanges) => void;
}

/**
 * Syncs the Library with the Wave account while signed in, with no button
 * (docs/spec.md, "When it talks to the service"): a change goes up a few
 * seconds after it's made, and the account is pulled when Wave opens, when
 * it comes back to the foreground and after each push. Offline, changes
 * wait in the store. A sync that fails tries again at the next of those, and
 * never reaches the Library. Signing out stops it; signing in again joins
 * the Library with the account as the first time does.
 */
export class WaveSync extends Context.Service<
  WaveSync,
  {
    /** Starts syncing while signed in (the app, not a headless start). Safe to call repeatedly. */
    readonly start: (ports: WaveSyncPorts) => Effect.Effect<void>;
    /**
     * Something changed in the Library here: it goes up a few seconds after
     * the last change. [songs]: the song list may have changed (a scan, a download).
     */
    readonly changed: (what: { readonly songs: boolean }) => Effect.Effect<void>;
  }
>()("@wave/mobile/sync/WaveSync") {}

const make = Effect.gen(function* () {
  const store = yield* LibraryStore;
  let ports: WaveSyncPorts | null = null;
  /** The account signed in (its email), or null. */
  let account: string | null = null;
  let running = false;
  /** Asked to sync while one was running: sync once more when it ends. */
  let again = false;
  /** The first sync after launch looks at the song list too. */
  let songsChanged = true;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const sync = (): void => {
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
    if (account === null || ports === null) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    again = false;
    const songs = songsChanged;
    songsChanged = false;
    const { preferences, pulled } = ports;
    void Effect.runPromise(
      store.syncWithAccount({
        transport: WaveAccount,
        preferences,
        account,
        now: Date.now,
        songsChanged: songs,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
    )
      .then(
        (result) => pulled(result.pulled),
        (error: unknown) => {
          // The song list is looked at again next time.
          if (songs) songsChanged = true;
          const cause = (error as { cause?: unknown }).cause;
          const code = waveAccountErrorCode(cause);
          if (code !== "ERR_WAVE_OFFLINE" && code !== "ERR_WAVE_SIGNED_OUT") {
            console.warn("[wave] Syncing with the Wave account didn't finish", error);
          }
        },
      )
      .finally(() => {
        running = false;
        if (again) sync();
      });
  };

  const sessionChanged = (session: WaveSession): void => {
    if (session.status === "signedIn") {
      const signedIn = session.account.email;
      const changedAccount = account !== signedIn;
      account = signedIn;
      if (changedAccount) sync();
      return;
    }
    account = null;
    if (pending !== undefined) clearTimeout(pending);
    pending = undefined;
    // The Library stays; the next sign-in joins it with the account anew.
    void Effect.runPromise(store.leaveAccount).catch((error: unknown) =>
      console.warn("[wave] Couldn't leave the Wave account", error),
    );
  };

  return WaveSync.of({
    start: (given) =>
      Effect.sync(() => {
        if (ports !== null) return;
        ports = given;
        WaveAccount.addListener("onSessionChanged", sessionChanged);
        WaveAccount.session().then(sessionChanged, () => {});
        AppState.addEventListener("change", (state) => {
          if (state === "active") sync();
        });
      }),
    changed: (what) =>
      Effect.sync(() => {
        if (what.songs) songsChanged = true;
        if (account === null) return;
        if (pending !== undefined) clearTimeout(pending);
        pending = setTimeout(sync, PUSH_DELAY_MS);
      }),
  });
});

export const layer = Layer.effect(WaveSync, make);
