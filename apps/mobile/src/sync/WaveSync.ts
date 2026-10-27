import type { WaveSession } from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AppState } from "react-native";

import { freeTurn } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import { WaveAccount, waveAccountErrorCode, type WaveAccountErrorCode } from "@/native/waveAccount";
import { perfCount } from "@/perf/perf";

import type { SyncedChanges, SyncPreferences } from "./syncCycle";
import { syncTriggers, type SyncClock } from "./syncTriggers";

/** Offline or signed out: a sync stops, and tries again at the next chance, with nothing to warn of. */
const expected = (code: WaveAccountErrorCode | null): boolean =>
  code === "ERR_WAVE_OFFLINE" || code === "ERR_WAVE_SIGNED_OUT";

/** What syncing needs from the app that only the app (not a headless start) has. */
export interface WaveSyncPorts {
  /** The synced preferences' values (`syncedPreferences`). */
  readonly preferences: SyncPreferences;
  /** Hears what each sync changed on the phone, to show it. */
  readonly pulled: (changes: SyncedChanges) => void;
  /**
   * Follows the Wave account's Soulseek account after each pull, natively
   * (`WaveSoulseek.followWaveAccount`): JS never sees its credentials. Then
   * Download in best quality's switch settles with its synced copy
   * (`followPulledBestQuality`), even when the first part failed.
   */
  readonly soulseek: () => Promise<unknown>;
}

/**
 * Syncs the Library with the Wave account while signed in, with no button
 * (docs/spec.md, "When it talks to the service"): an edit goes up a few
 * seconds after it's made, play ends in batches (`syncTriggers`), and the
 * account is pulled when Wave opens, when it comes back to the foreground
 * after a while and after each push. Offline, changes
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
    /** A play started or ended here: its play goes up in the next batch of play ends. */
    readonly played: (step: "started" | "ended") => Effect.Effect<void>;
  }
>()("@wave/mobile/sync/WaveSync") {}

const make = Effect.gen(function* () {
  const store = yield* LibraryStore;
  let ports: WaveSyncPorts | null = null;
  /** The account signed in (its email), or null. */
  let account: string | null = null;

  const clock: SyncClock = {
    now: Date.now,
    after: (ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  };

  /** One sync; resolves whether it finished. */
  const run = async (songs: boolean): Promise<boolean> => {
    if (account === null || ports === null) return false;
    perfCount("sync.run");
    const { preferences, pulled, soulseek } = ports;
    const finished = await Effect.runPromise(
      store.syncWithAccount({
        transport: WaveAccount,
        preferences,
        account,
        now: Date.now,
        songsChanged: songs,
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        // Each database step waits until the owner's taps are through.
        turn: freeTurn,
      }),
    ).then(
      (result) => {
        pulled(result.pulled);
        return true;
      },
      (error: unknown) => {
        if (!expected(waveAccountErrorCode((error as { cause?: unknown }).cause))) {
          console.warn("[wave] Syncing with the Wave account didn't finish", error);
        }
        return false;
      },
    );
    // The Soulseek account follows the Wave account's at each pull, the first after sign-in too.
    if (account !== null) {
      await soulseek().catch((error: unknown) => {
        const code = waveAccountErrorCode(error);
        if (!expected(code)) {
          // The code only: the native module's errors never carry the account.
          console.warn("[wave] Couldn't follow the Wave account's Soulseek account", { code });
        }
      });
    }
    return finished;
  };

  // The first sync after launch looks at the song list too.
  const triggers = syncTriggers({ clock, run, songsChanged: true });

  const sessionChanged = (session: WaveSession): void => {
    if (session.status === "signedIn") {
      const signedIn = session.account.email;
      const changedAccount = account !== signedIn;
      account = signedIn;
      if (changedAccount) triggers.now();
      return;
    }
    account = null;
    triggers.stop();
    // The Library stays, but for its missing songs; the next sign-in joins it with the account anew.
    void Effect.runPromise(store.leaveAccount).then(
      () =>
        ports?.pulled({
          songs: false,
          library: true,
          playlists: true,
          favorites: true,
          plays: false,
          preferences: [],
        }),
      (error: unknown) => console.warn("[wave] Couldn't leave the Wave account", error),
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
          if (state === "active" && account !== null) triggers.foreground();
        });
      }),
    changed: (what) =>
      Effect.sync(() => {
        // Signed out: signing in joins the Library anew, its song list with it.
        if (account !== null) triggers.edited(what);
      }),
    played: (step) =>
      Effect.sync(() => {
        if (account !== null) triggers.played(step);
      }),
  });
});

export const layer = Layer.effect(WaveSync, make);
