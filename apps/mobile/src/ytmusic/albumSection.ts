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
import { useCallback, useEffect, useState } from "react";

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

export interface YtAlbumSection {
  /** What the album's page shows from YouTube Music, or null: nothing (Core's `ytLibraryAlbumView`). */
  readonly view: YtLibraryAlbumView<NativeYtSong, SongRow> | null;
  /** Show on YouTube Music: asks for the artist or, once the release is known, reads it again. */
  readonly show: () => void;
}

/**
 * What a Library [album]'s page shows from YouTube Music, through its album
 * artist [name] ([artistId]): with that artist's YouTube Music answer saved
 * (their page's), the album's release is found among their releases and its
 * page read at once, its songs joining the album's [tracks]; otherwise
 * nothing is asked until `show` is called.
 */
export const useYtAlbumSection = (
  name: string,
  artistId: number,
  album: LibraryAlbumKey,
  tracks: readonly SongRow[],
): YtAlbumSection => {
  const { state, enabled, openedAt, show: askArtist } = useYtArtistAnswer(name);
  const find = useLoadedLibraryFinder();
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
          releasePage,
        });

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
  const show = useCallback(
    () => (hasRelease ? setAttempt((count) => count + 1) : askArtist()),
    [hasRelease, askArtist],
  );
  return { view, show };
};
