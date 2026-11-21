/**
 * Home's Community playlists (docs/spec.md, YT Music): the playlists of the
 * shelves YouTube Music shows on the connected account's home. The list is
 * kept on the phone (not synced), so Home shows it at once and offline; the
 * home is read again in the background when Home comes into focus and Core
 * says a read is due (`homeCommunityPlaylistsDue`: at most once a day). The
 * kept list stays until a read succeeds.
 */
import {
  HOME_COMMUNITY_PLAYLISTS_RETRY_MS,
  communityPlaylistsAccount,
  homeCommunityPlaylistsDue,
  homeCommunityPlaylistsShown,
  keptCommunityPlaylists,
  newCommunityPlaylistsSalt,
  parseKeptCommunityPlaylists,
  storedKeptCommunityPlaylists,
  type KeptCommunityPlaylists,
  type YtAccount,
  type YtCommunityPlaylist,
  type YtSession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo } from "react";

import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";

import { homeTurnOf } from "./homeWork";
import { withNetworkLog } from "@/lib/networkMeter";
import { persistedSetting } from "@/lib/persistedSetting";
import { appRuntime } from "@/library/runtime";
import { WaveYtMusic } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { YtMusic } from "@/ytmusic/YtMusic";

/** The list as last read, with when and for which account. */
const kept = persistedSetting<KeptCommunityPlaylists | null>({
  key: "home.communityPlaylists",
  read: parseKeptCommunityPlaylists,
  write: storedKeptCommunityPlaylists,
});

const storedText = (stored: string | null): string | null => stored;

/** This phone's salt for the accounts' keys (`communityPlaylistsAccount`), kept beside the list. */
const saltSetting = persistedSetting<string | null>({
  key: "home.communityPlaylistsSalt",
  read: storedText,
  write: storedText,
});

/**
 * The connected account as Home last saw it (its key, never its email); null
 * signed out, expired or never seen. Kept on the phone, so Home's first frame
 * shows the list of the account it belongs to without waiting for the session.
 */
const reader = persistedSetting<string | null>({
  key: "home.communityPlaylistsReader",
  read: storedText,
  write: storedText,
});

/** A read going on: Home coming back into focus meanwhile doesn't start another. */
let reading = false;

/** After a read that failed: no read before then (ms since the epoch). */
let retryAt: number | null = null;

/** Whether Home follows the session's changes (from its first answer on). */
let following = false;

/** The phone's salt, made the first time it's needed. */
const salt = (): string => {
  const stored = saltSetting.get();
  if (stored !== null) return stored;
  const made = newCommunityPlaylistsSalt();
  saltSetting.set(made);
  return made;
};

const keyOf = (account: YtAccount): string => communityPlaylistsAccount(account, salt());

const readerOf = (session: YtSession): string | null =>
  session.status === "signedIn" ? keyOf(session.account) : null;

/** What a read gave, for its line in the app log. */
const readOutcome = (count: number): string =>
  count === 0 ? "no playlist" : count === 1 ? "1 playlist" : `${count} playlists`;

/**
 * Reads the home when a read is due for [current] (the connected account's
 * key). What it gives is kept for the account native says it was read as,
 * whoever is connected by the time it answers. Native gives it its deadline.
 */
const refresh = (current: string): void => {
  const due = homeCommunityPlaylistsDue(kept.get(), {
    now: Date.now(),
    account: current,
    reading,
    retryAt,
  });
  if (!due) return;
  reading = true;
  const read = withNetworkLog(
    "Community playlists read",
    Effect.gen(function* () {
      const ytMusic = yield* YtMusic;
      const home = yield* ytMusic.homePlaylistShelves;
      // The network wait isn't a slice; the JS handling its answer takes a free turn on Home.
      yield* homeTurnOf(freeTurnEffect);
      return keptCommunityPlaylists(kept.get(), home.shelves, {
        now: Date.now(),
        account: keyOf(home.account),
      });
    }),
    (list) => readOutcome(list.playlists.length),
  );
  void appRuntime
    .runPromise(homeTurnOf(settledTurnEffect).pipe(Effect.andThen(Effect.result(read))))
    .then((result) => {
      if (Result.isSuccess(result)) {
        retryAt = null;
        kept.set(result.success);
      } else retryAt = Date.now() + HOME_COMMUNITY_PLAYLISTS_RETRY_MS;
    })
    .catch(() => {
      retryAt = Date.now() + HOME_COMMUNITY_PLAYLISTS_RETRY_MS;
    })
    .finally(() => {
      reading = false;
    });
};

/**
 * Home came into focus: who is connected is read from the saved session
 * (YouTube isn't asked). From then on a sign-in, sign-out or expiry changes
 * who Home shows the list to as it happens; the session is loaded by then, so
 * following it costs Wave's start nothing.
 */
const focus = (enabled: boolean): void => {
  if (!enabled) return;
  void askYtMusic((ytMusic) => ytMusic.session)
    .then((session) => {
      if (!Result.isSuccess(session)) return;
      const current = readerOf(session.success);
      reader.set(current);
      if (!following) {
        following = true;
        WaveYtMusic.addListener("onSessionChanged", (changed) => reader.set(readerOf(changed)));
      }
      if (current !== null) refresh(current);
    })
    .catch(() => {});
};

/**
 * What Home's Community playlists shows (Core's `homeCommunityPlaylistsShown`):
 * the kept list of the connected account, none while YT Music is off, signed
 * out or with nothing kept. Each focus of the screen checks whether a read
 * is due.
 */
export const useCommunityPlaylists = (): readonly YtCommunityPlaylist[] => {
  const enabled = useYtMusicEnabled();
  const list = kept.useValue();
  const current = reader.useValue();
  useFocusEffect(useCallback(() => focus(enabled), [enabled]));
  return useMemo(
    () => homeCommunityPlaylistsShown(list, { account: enabled ? current : null }),
    [list, enabled, current],
  );
};
