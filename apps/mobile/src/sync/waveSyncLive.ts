import type { WaveSession } from "@wave/core";
import * as Effect from "effect/Effect";
import { AppState } from "react-native";

import { freeTurn } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import { WaveAccount, waveAccountErrorCode, type WaveAccountErrorCode } from "@/native/waveAccount";
import { perfCount } from "@/perf/perf";

import { syncTriggers, type SyncClock, type SyncTriggers } from "./syncTriggers";
import { WaveSync, type WaveSyncPorts } from "./WaveSync";

/** Offline or signed out: a sync stops, and tries again at the next chance, with nothing to warn of. */
const expected = (code: WaveAccountErrorCode | null): boolean =>
  code === "ERR_WAVE_OFFLINE" || code === "ERR_WAVE_SIGNED_OUT";

/** Syncing over the Library store (`WaveSync`'s layer builds it on first use). */
export const make = Effect.gen(function* () {
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

  /** Made at the first sign-in: signed out, nothing loads or times a sync. */
  let triggers: SyncTriggers | null = null;
  // The first sync after launch looks at the song list too.
  const signedInTriggers = (): SyncTriggers =>
    (triggers ??= syncTriggers({ clock, run, songsChanged: true }));

  const sessionChanged = (session: WaveSession): void => {
    if (session.status === "signedIn") {
      const signedIn = session.account.email;
      const changedAccount = account !== signedIn;
      account = signedIn;
      if (changedAccount) signedInTriggers().now();
      return;
    }
    account = null;
    triggers?.stop();
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
          if (state === "active" && account !== null) signedInTriggers().foreground();
        });
      }),
    changed: (what) =>
      Effect.sync(() => {
        // Signed out: signing in joins the Library anew, its song list with it.
        if (account !== null) signedInTriggers().edited(what);
      }),
    played: (step) =>
      Effect.sync(() => {
        if (account !== null) signedInTriggers().played(step);
      }),
  });
});
