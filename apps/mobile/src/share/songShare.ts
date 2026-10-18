import { joinArtists, type ArtworkPalette } from "@wave/core";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { appLog } from "@/log/appLog";
import { cacheStreamedCover } from "@/playback/queueTracks";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { YtMusic } from "@/ytmusic/YtMusic";

const LOG_TAG = "SongShare";

/** What a song's card shows (docs/spec.md, "Sharing a song"). */
export interface SongShareContent {
  readonly title: string;
  readonly artist: string;
  /** URI of the cover (a file, or YouTube's address until it's cached); absent without artwork. */
  readonly artworkUri: string | undefined;
  /** The cover's palette, which the card and the story's gradient take; null without one (yet). */
  readonly palette: ArtworkPalette | null;
}

/** The song whose share sheet is open, or null. */
const shared = makeExternalStore<SongShareContent | null>(null);

/**
 * Opens the song share sheet on [content]. [later], when given, finishes it
 * (the cover's palette, the cover cached on the phone); the sheet shows what
 * it has meanwhile and takes the rest if it's still open on that song.
 */
export const openSongShare = (
  content: SongShareContent,
  later?: Promise<Partial<SongShareContent>>,
): void => {
  shared.set(content);
  later
    ?.then((more) => {
      if (shared.get() === content) shared.set({ ...content, ...more });
    })
    .catch((error: unknown) =>
      appLog("warn", LOG_TAG, `Couldn't read the cover: ${String(error)}`),
    );
};

export const closeSongShare = (): void => shared.set(null);

export const useSongShare = (): SongShareContent | null =>
  useSyncExternalStore(shared.subscribe, shared.get);

const fileUri = (path: string | null): string | undefined =>
  path === null ? undefined : `file://${path}`;

/** Shares a Library song: its cover, and its palette as the Library keeps it. */
export const shareLibrarySong = (song: SongRow): void =>
  openSongShare(
    {
      title: song.title,
      artist: song.artist,
      artworkUri: fileUri(song.artworkPath),
      palette: null,
    },
    appRuntime.runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        const details = yield* store.trackDetails(song.id);
        return { palette: details?.palette ?? null };
      }),
    ),
  );

/** A song YouTube Music has (streamed, or a playlist's unsearched entry), as its card needs it. */
export interface StreamedShareSong {
  readonly title: string;
  readonly artists: readonly string[];
  readonly artworkUrl: string | null;
}

/**
 * Shares a song that isn't a Library file: YouTube's cover, cached on the
 * phone as playback caches it, which gives its palette too. With YT Music
 * off nothing is asked of YouTube: the card has no cover.
 */
export const shareStreamedSong = (song: StreamedShareSong): void => {
  const url = ytMusicEnabled() ? song.artworkUrl : null;
  openSongShare(
    {
      title: song.title,
      artist: joinArtists(song.artists),
      artworkUri: url ?? undefined,
      palette: null,
    },
    url === null
      ? undefined
      : appRuntime.runPromise(
          Effect.gen(function* () {
            const ytMusic = yield* YtMusic;
            const artwork = yield* cacheStreamedCover(url, ytMusic.cacheArtwork);
            return { artworkUri: `file://${artwork.path}`, palette: artwork.palette };
          }),
        ),
  );
};
