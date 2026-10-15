import {
  ytAlbumSongs,
  ytLibraryAlbumView,
  type LibraryAlbumKey,
  type YtArtistAlbum,
  type YtLibraryAlbumView,
  type YtReleaseLoad,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useRef, useState } from "react";

import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";

import { useYtArtistAnswer } from "./artistSection";
import { askYtMusic } from "./askYtMusic";
import { useLoadedLibraryFinder } from "./libraryFinder";

type Load = YtReleaseLoad<NativeYtSong>;

/** The songs of the release [browseId], read once a session (`readYtAlbum`). */
const readRelease = (browseId: string) =>
  askYtMusic((ytMusic) =>
    ytMusic.album(browseId).pipe(Effect.map((album) => ytAlbumSongs(browseId, album))),
  );

const pageKey = (browseId: string, attempt: number): string => `${browseId}#${attempt}`;

/** The album only needs the artist's releases: their page, not every song of theirs. */
const RELEASES_ONLY = { allSongs: false } as const;

export interface YtAlbumSection {
  /** What the album's page shows from YouTube Music, or null: nothing (Core's `ytLibraryAlbumView`). */
  readonly view: YtLibraryAlbumView<NativeYtSong, SongRow> | null;
  /**
   * Show on YouTube Music: integrates the album or, once it is, asks for the
   * artist again or reads the release again.
   */
  readonly show: () => void;
}

/**
 * What a Library [album]'s page shows from YouTube Music, through its album
 * artist [name] ([artistId]). Opened from an integrated view
 * ([openedIntegrated]), or once Show on YouTube Music is tapped, the album is
 * integrated: it asks for the artist's page if nothing stands for them (the
 * page only, not every song of theirs: saved, it doesn't stand on their
 * artist page, and it never replaces an answer that does), finds its release
 * among their releases and reads it, its songs joining the album's
 * [tracks]. Otherwise nothing is asked.
 */
export const useYtAlbumSection = (
  name: string,
  artistId: number,
  album: LibraryAlbumKey,
  tracks: readonly SongRow[],
  openedIntegrated: boolean,
): YtAlbumSection => {
  const { state, enabled, openedAt, show: askArtist } = useYtArtistAnswer(name, RELEASES_ONLY);
  const find = useLoadedLibraryFinder();
  const [integrated, setIntegrated] = useState(openedIntegrated);
  // Bumped to read the release's page again after it got no answer.
  const [attempt, setAttempt] = useState(0);
  // The last answer, for the release and attempt it was read for; another is still loading.
  const [page, setPage] = useState<{ readonly key: string; readonly load: Load } | null>(null);

  const releasePage = useCallback(
    (release: YtArtistAlbum): Load | undefined =>
      page?.key === pageKey(release.browseId, attempt) ? page.load : undefined,
    [page, attempt],
  );
  // Until the Library has been read, which songs it lacks isn't known: nothing shows.
  const view =
    find === null
      ? null
      : ytLibraryAlbumView(state, {
          name,
          artistId,
          album,
          tracks,
          elsewhere: find,
          enabled,
          now: openedAt,
          integrated,
          releasePage,
        });

  // The artist is asked for on its own once; after a failure it waits for the button.
  const askedOnItsOwn = useRef(false);
  const askNow = view?.askArtist === true;
  useEffect(() => {
    if (!askNow || askedOnItsOwn.current) return;
    askedOnItsOwn.current = true;
    askArtist();
  }, [askNow, askArtist]);

  const browseId = view?.release?.browseId;
  useEffect(() => {
    if (browseId === undefined) return;
    let current = true;
    void readRelease(browseId).then((result) => {
      if (!current) return;
      setPage({
        key: pageKey(browseId, attempt),
        load: Result.isSuccess(result)
          ? { status: "loaded", songs: result.success }
          : { status: "quiet", reason: result.failure.reason === "offline" ? "offline" : "failed" },
      });
    });
    return () => {
      current = false;
    };
  }, [browseId, attempt]);

  const hasRelease = browseId !== undefined;
  const show = useCallback(() => {
    if (!integrated) setIntegrated(true);
    else if (hasRelease) setAttempt((count) => count + 1);
    else askArtist();
  }, [integrated, hasRelease, askArtist]);
  return { view, show };
};
