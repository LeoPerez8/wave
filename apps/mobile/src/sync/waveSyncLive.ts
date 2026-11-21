import { SYSTEM_SYNC_CLOCK, syncTriggers, type SyncTriggers, type WaveSession } from "@wave/core";
import * as Effect from "effect/Effect";
import { AppState } from "react-native";

import { freeTurn } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";

import { WaveAccount, waveAccountErrorCode, type WaveAccountErrorCode } from "@/native/waveAccount";
import { perfCount } from "@/perf/perf";

import { collaborations } from "./collaborations";
import { accountNameBeforePull } from "./accountNameBeforePull";
import type { WaveSync, WaveSyncPorts } from "./WaveSync";

/** Offline or signed out: a sync stops, and tries again at the next chance, with nothing to warn of. */
const expected = (code: WaveAccountErrorCode | null): boolean =>
  code === "ERR_WAVE_OFFLINE" || code === "ERR_WAVE_SIGNED_OUT";

/** Syncing over the Library store (`WaveSync`'s layer builds it on first use). */
export const make = Effect.gen(function* () {
  const store = yield* LibraryStore;
  let ports: WaveSyncPorts | null = null;
  /** The account signed in (its email), or null. */
  let account: string | null = null;

  /** The sync running or the last one, so the account's and a page's never overlap. */
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <A>(work: () => Promise<A>): Promise<A> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  /** One sync; resolves whether it finished. */
  const run = (songs: boolean): Promise<boolean> => inTurn(() => runCycle(songs));

  const runCycle = async (songs: boolean): Promise<boolean> => {
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
        turn: () => freeTurn("sync"),
        collaboration: collaborations,
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

  /** The page of the collaborative playlist [playlistId] pulls it. */
  const syncPlaylist = (playlistId: number): Promise<void> =>
    inTurn(async () => {
      if (account === null || ports === null) return;
      const { preferences, pulled } = ports;
      const result = await Effect.runPromise(
        store.syncCollaborativePlaylist(
          {
            transport: WaveAccount,
            preferences,
            account,
            now: Date.now,
            songsChanged: false,
            wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            turn: () => freeTurn("collaborative playlist sync"),
            collaboration: collaborations,
          },
          playlistId,
        ),
      ).catch((error: unknown) => {
        if (!expected(waveAccountErrorCode((error as { cause?: unknown }).cause))) {
          console.warn("[wave] Syncing a collaborative playlist didn't finish", error);
        }
        return null;
      });
      if (result !== null) pulled(result.pulled);
    });

  /** Made at the first sign-in: signed out, nothing loads or times a sync. */
  let triggers: SyncTriggers | null = null;
  // The first sync after launch looks at the song list too.
  const signedInTriggers = (): SyncTriggers =>
    (triggers ??= syncTriggers({
      clock: SYSTEM_SYNC_CLOCK,
      inForeground: () => AppState.currentState === "active",
      run,
      songsChanged: true,
    }));

  const sessionChanged = (session: WaveSession): void => {
    if (session.status === "signedIn") {
      const signedIn = session.account.email;
      const changedAccount = account !== signedIn;
      account = signedIn;
      if (changedAccount) {
        void accountNameBeforePull(session, collaborations.setAccountName, () => {
          if (account === signedIn) signedInTriggers().now();
        });
      }
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
          // Follows, dismissed suggestions and dislikes stay on the phone as they are.
          follows: false,
          dismissedSuggestions: false,
          dislikes: false,
          preferences: [],
        }),
      (error: unknown) => console.warn("[wave] Couldn't leave the Wave account", error),
    );
  };

  const sync: WaveSync["Service"] = {
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
    syncPlaylist: (playlistId) => Effect.promise(() => syncPlaylist(playlistId)),
    now: Effect.sync(() => {
      if (account !== null) signedInTriggers().now();
    }),
  };
  return sync;
});
