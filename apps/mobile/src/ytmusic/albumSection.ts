import {
  ytAlbumSongs,
  type YtAlbumEntry,
  type LibraryAlbumKey,
  type YtArtistAlbum,
  type YtLibraryAlbumView,
  type YtPick,
  type YtReleaseLoad,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useRef, useState } from "react";

import type { LineToggle } from "@/catalog/PlayShuffle";
import type { SongRow } from "@/library/LibraryStore";
import { useScreenSettled } from "@/lib/screenTiming";
import { useVisitState } from "@/lib/useVisitState";
import { online } from "@/native/waveNative";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useSearchOnlineAlways } from "@/settings/searchOnline";

import { useYtArtistAnswer } from "./artistSection";
import { albumOpening } from "./albumOpening";
import { artistOpeningRequest } from "./artistOpeningRequest";
import { askYtMusic } from "./askYtMusic";
import { useLoadedLibraryFinder } from "./libraryFinder";
import { useLineToggle } from "./OnlineToggle";

type Load = YtReleaseLoad<NativeYtSong>;

/** The songs of the release [browseId], read once a session (`readYtAlbum`). */
const readRelease = (browseId: string, signal: AbortSignal) =>
  askYtMusic(
    (ytMusic) =>
      artistOpeningRequest(online, ytMusic.album(browseId)).pipe(
        Effect.map((album) => ytAlbumSongs(browseId, album)),
      ),
    signal,
  );

const pageKey = (browseId: string, attempt: number): string => `${browseId}#${attempt}`;

/** The album only needs the artist's releases: their page, not every song of theirs. */
const RELEASES_ONLY = { allSongs: false } as const;

export interface YtAlbumSection {
  /** What the album's page shows from YouTube Music, or null: nothing (Core's `ytLibraryAlbumView`). */
  readonly view: YtLibraryAlbumView<NativeYtSong, SongRow> | null;
  /** The page's Library | Online toggle, or null when it has none (YT Music off…). */
  readonly toggle: LineToggle | null;
}

/**
 * What a Library [album]'s page shows from YouTube Music, through its album
 * artist [name] ([artistId]), and its Library | Online toggle. Opened from an
 * integrated view ([openedIntegrated]), or with Search online set to Always,
 * it opens with Online selected (Always: Library again after an ask on its
 * own that got no answer, with the quiet line); with
 * Online, the album is integrated: it asks for the artist's page if nothing
 * stands for them (the page only, not every song of theirs: saved, it
 * doesn't stand on their artist page, and it never replaces an answer that
 * does), finds its release among their releases and reads it, its songs
 * joining the album's [tracks]. With Library nothing is asked and the album
 * shows as it is; Online again reuses what was read. After an ask that got
 * no answer, picking Online asks again. With [keepTracklist] (the page showed
 * the joined tracklist this visit), it stays once every song is downloaded.
 */
export const useYtAlbumSection = (
  name: string,
  artistId: number,
  album: LibraryAlbumKey,
  tracks: readonly SongRow[],
  openedIntegrated: boolean,
  keepTracklist: boolean,
  contentReady: boolean,
): YtAlbumSection => {
  const { state, enabled, openedAt, show: askArtist } = useYtArtistAnswer(name, RELEASES_ONLY);
  const settled = useScreenSettled();
  const connected = online();
  const [retryArtist, setRetryArtist] = useState(0);
  const always = useSearchOnlineAlways();
  // The toggle's segment picked while the page is open; null until one is.
  const [pick, setPick] = useState<YtPick | null>(null);
  // Bumped to read the release's page again after it got no answer.
  const [attempt, setAttempt] = useState(0);
  // The last answer, for the release and attempt it was read for; another is still loading.
  const [page, setPage] = useState<{ readonly key: string; readonly load: Load } | null>(null);

  const releasePage = useCallback(
    (release: YtArtistAlbum): Load | undefined =>
      page?.key === pageKey(release.browseId, attempt) ? page.load : undefined,
    [page, attempt],
  );
  const context = {
    name,
    artistId,
    album,
    tracks,
    elsewhere: () => null,
    enabled,
    now: openedAt,
    integrated: openedIntegrated,
    always,
    pick,
    releasePage,
    keepTracklist,
    contentReady,
    settled,
    online: connected,
    retryArtist: retryArtist > 0,
  };
  const work = albumOpening(state, context);
  const find = useLoadedLibraryFinder(work.finder);
  const [held, hold] = useVisitState<readonly YtAlbumEntry<NativeYtSong, SongRow>[] | null>(
    null,
    `${artistId}/${album.title}`,
  );
  const view = albumOpening(state, context, find, held).view;
  const entries = view?.tracks ?? null;
  useEffect(() => {
    if (entries !== null && entries !== held) hold(entries);
  }, [entries, held, hold]);

  // The artist is asked for on its own once; after a failure it waits for Online again.
  const askedOnItsOwn = useRef(false);
  const askNow = work.askArtist;
  useEffect(() => {
    if (!askNow || askedOnItsOwn.current) return;
    askedOnItsOwn.current = true;
    setRetryArtist(0);
    askArtist();
  }, [askNow, askArtist]);

  const browseId = work.readRelease;
  useEffect(() => {
    if (browseId === null) return;
    let current = true;
    const cancel = new AbortController();
    void readRelease(browseId, cancel.signal).then(
      (result) => {
        if (!current) return;
        setPage({
          key: pageKey(browseId, attempt),
          load: Result.isSuccess(result)
            ? { status: "loaded", songs: result.success }
            : {
                status: "quiet",
                reason: result.failure.reason === "offline" ? "offline" : "failed",
              },
        });
      },
      () => {
        if (current)
          setPage({ key: pageKey(browseId, attempt), load: { status: "quiet", reason: "failed" } });
      },
    );
    return () => {
      current = false;
      cancel.abort();
    };
  }, [browseId, attempt]);

  const retry = view?.retry ?? null;
  const onPick = useCallback(
    (next: YtPick) => {
      setPick(next);
      if (next !== "online") return;
      // Online after an ask that got no answer asks again: the release's page, or the artist.
      if (retry === "release") setAttempt((count) => count + 1);
      else if (retry === "artist") {
        askedOnItsOwn.current = false;
        setRetryArtist((count) => count + 1);
      }
    },
    [retry, setPick, setAttempt, setRetryArtist],
  );
  const toggle = useLineToggle(view?.toggle, onPick);
  return { view, toggle };
};
