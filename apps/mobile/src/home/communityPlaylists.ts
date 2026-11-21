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
  homeCommunityPlaylistsDue,
  homeCommunityPlaylistsShown,
  keptCommunityPlaylists,
  parseKeptCommunityPlaylists,
  storedKeptCommunityPlaylists,
  type KeptCommunityPlaylists,
  type YtCommunityPlaylist,
  type YtSession,
} from "@wave/core";
import { makeExternalStore } from "@wave/client/externalStore";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { settledTurnEffect } from "@/lib/backgroundWork";
import { withNetworkLog } from "@/lib/networkMeter";
import { persistedSetting } from "@/lib/persistedSetting";
import { appRuntime } from "@/library/runtime";
import { useYtMusicEnabled } from "@/settings/ytMusic";
import { askYtMusic } from "@/ytmusic/askYtMusic";
import { YtMusic } from "@/ytmusic/YtMusic";

/** The list as last read, with when and for which account. */
const kept = persistedSetting<KeptCommunityPlaylists | null>({
  key: "home.communityPlaylists",
  read: parseKeptCommunityPlaylists,
  write: storedKeptCommunityPlaylists,
});

/**
 * The connected account as Home last saw it (its email, or its name when
 * YouTube Music gives none); null signed out, expired, or not asked yet.
 */
const account = makeExternalStore<string | null>(null);

/** A read going on: Home coming back into focus meanwhile doesn't start another. */
let reading = false;

/** After a read that failed: no read before then (ms since the epoch). */
let retryAt: number | null = null;

/** The home's first pages get this long: the read is in the background, nothing waits on it. */
const READ_TIMEOUT = "30 seconds";

const accountOf = (session: YtSession): string | null =>
  session.status === "signedIn" ? (session.account.email ?? session.account.name) : null;

/** What a read gave, for its line in the app log. */
const readOutcome = (count: number): string =>
  count === 0 ? "no playlist" : count === 1 ? "1 playlist" : `${count} playlists`;

/** Reads the home as [reader] when a read is due, keeping what it gives. */
const refresh = (reader: string): void => {
  const due = homeCommunityPlaylistsDue(kept.get(), {
    now: Date.now(),
    account: reader,
    reading,
    retryAt,
  });
  if (!due) return;
  reading = true;
  const read = withNetworkLog(
    "Community playlists read",
    Effect.gen(function* () {
      const ytMusic = yield* YtMusic;
      const shelves = yield* ytMusic.homePlaylistShelves.pipe(Effect.timeout(READ_TIMEOUT));
      return keptCommunityPlaylists(kept.get(), shelves, { now: Date.now(), account: reader });
    }),
    (list) => readOutcome(list.playlists.length),
  );
  void appRuntime
    .runPromise(settledTurnEffect.pipe(Effect.andThen(Effect.result(read))))
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

/** Home came into focus: who is connected is read from the saved session (YouTube isn't asked). */
const focus = (enabled: boolean): void => {
  if (!enabled) return;
  void askYtMusic((ytMusic) => ytMusic.session)
    .then((session) => {
      if (!Result.isSuccess(session)) return;
      const reader = accountOf(session.success);
      account.set(reader);
      if (reader !== null) refresh(reader);
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
  const reader = useSyncExternalStore(account.subscribe, account.get);
  useFocusEffect(useCallback(() => focus(enabled), [enabled]));
  return useMemo(
    () => homeCommunityPlaylistsShown(list, { account: enabled ? reader : null }),
    [list, enabled, reader],
  );
};
