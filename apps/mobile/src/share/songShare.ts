import {
  joinArtists,
  librarySearchSong,
  lookUpSongVideo,
  lookUpSpotifyTrack,
  parseTrackId,
  SONG_LINKS_LOADING,
  spotifySearchQuery,
  type ArtworkPalette,
  type SongLinkLookup,
  type SongLinkSearch,
  type SongLinkSpotify,
  type SongLinksState,
  type UnsearchedSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { LibraryStore, type SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { appLog } from "@/log/appLog";
import { cacheStreamedCover } from "@/playback/queueTracks";
import { spotifySignedIn } from "@/settings/spotifyAccount";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { askSpotifyAccount } from "@/spotify/askSpotify";
import { searchSongsInTurn } from "@/ytmusic/askYtMusic";
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
  /**
   * Where the song's links stand (Copy Link, Spotify, YT Music); null with YT
   * Music off, which hides the link options and asks nothing.
   */
  readonly links: SongLinksState | null;
}

/** The song whose share sheet is open, or null. */
const shared = makeExternalStore<SongShareContent | null>(null);

/** Which sheet is open: what arrives for an earlier one is dropped. */
let opened = 0;

/** One YouTube Music Songs search for a song without a video id, in the search allowance (as Share). */
const searchForLinks: SongLinkSearch = async (song) =>
  (await searchSongsInTurn("share", spotifySearchQuery(song))) ?? { ok: false, reason: "failed" };

/** The signed-in Spotify account: its saved session, and its own search (as sharing a playlist). */
const spotifyForLinks: SongLinkSpotify = {
  signedIn: spotifySignedIn,
  search: (term) => askSpotifyAccount((spotify) => spotify.searchTracks(term)),
};

/** [lookUp]'s answer, a lookup that threw counting as a failure. */
const settled = <S>(what: string, lookUp: Promise<S>): Promise<S | { status: "failed" }> =>
  lookUp.catch((error: unknown) => {
    appLog("warn", LOG_TAG, `Couldn't look up the song's ${what}: ${String(error)}`);
    return { status: "failed" } as const;
  });

/**
 * Opens the song share sheet on [content]. [later], when given, finishes it
 * (the cover's palette, the cover cached on the phone), and [links] looks up
 * the song's links while YT Music is on: its video id, for Copy Link and YT
 * Music (Core's `lookUpSongVideo`), and apart from it its Spotify track
 * (`lookUpSpotifyTrack`). The sheet shows what it has meanwhile and takes
 * each answer if it's still open on that song.
 */
const openSongShare = (
  content: Omit<SongShareContent, "links">,
  later?: Promise<Partial<SongShareContent>>,
  links?: () => Promise<SongLinkLookup>,
): void => {
  const sheet = ++opened;
  const withLinks = ytMusicEnabled() && links !== undefined;
  shared.set({ ...content, links: withLinks ? SONG_LINKS_LOADING : null });
  const take = (more: Partial<SongShareContent>): void => {
    const now = shared.get();
    if (sheet === opened && now !== null) shared.set({ ...now, ...more });
  };
  later
    ?.then(take)
    .catch((error: unknown) =>
      appLog("warn", LOG_TAG, `Couldn't read the cover: ${String(error)}`),
    );
  if (!withLinks) return;
  const song = links();
  // Each destination's answer lands on its own: Spotify doesn't wait for the video, or fail it.
  /** Looks up the song's [what] with [find] and takes the answer as its [key] links. */
  const lookUp = <K extends keyof SongLinksState>(
    key: K,
    what: string,
    find: (found: SongLinkLookup) => Promise<SongLinksState[K]>,
  ): void => {
    void settled(what, song.then(find)).then((state) => {
      if (state.status !== "found") appLog("info", LOG_TAG, `No ${key} link: ${state.status}`);
      take({ links: { ...(shared.get()?.links ?? SONG_LINKS_LOADING), [key]: state } });
    });
  };
  lookUp("video", "video", (found) => lookUpSongVideo(found, searchForLinks));
  lookUp("spotify", "Spotify track", (found) => lookUpSpotifyTrack(found.search, spotifyForLinks));
};

export const closeSongShare = (): void => {
  opened += 1;
  shared.set(null);
};

export const useSongShare = (): SongShareContent | null =>
  useSyncExternalStore(shared.subscribe, shared.get);

const fileUri = (path: string | null): string | undefined =>
  path === null ? undefined : `file://${path}`;

/**
 * The links lookup of the Library song [id]: by the video id it was
 * downloaded from, else a search for its title and artist (Core's
 * `librarySearchSong`); nothing to search for a song no longer indexed.
 */
const librarySongLinks = (id: number) => (): Promise<SongLinkLookup> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const store = yield* LibraryStore;
      const [song] = yield* store.songsWithIds([id]);
      const videoIds = yield* store.videoIds([id]);
      return {
        videoId: videoIds.get(id) ?? null,
        search: song === undefined ? null : librarySearchSong(song),
      };
    }),
  );

/**
 * Shares a Library song: its cover, and its palette as the Library keeps it.
 * Its links go by the video id it was downloaded from, else a search for its
 * title and artist.
 */
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
    librarySongLinks(song.id),
  );

/**
 * A song YouTube Music has (streamed, with its video id), or a playlist's
 * unsearched entry (searched for its links), as its share sheet needs it.
 */
export type StreamedShareSong = UnsearchedSong & { readonly videoId?: string };

/** The links lookup of streamed [song]: by its video id, else a search for its title and artists. */
const streamedSongLinks =
  ({ videoId, title, artists, album, durationMs }: StreamedShareSong) =>
  (): Promise<SongLinkLookup> =>
    Promise.resolve({ videoId: videoId ?? null, search: { title, artists, album, durationMs } });

/**
 * Shares a song that isn't a Library file: YouTube's cover, cached on the
 * phone as playback caches it, which gives its palette too. Its links go by
 * its video id, else (an unsearched entry) a search for its title and
 * artists. With YT Music off nothing is asked of YouTube: the card has no
 * cover, and there are no links.
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
    streamedSongLinks(song),
  );
};

/**
 * Shares what Now Playing plays, as it shows it ([content]: its cover and
 * palette), with the song's links as its menu's Share looks them up: a
 * Library track ([trackId]) by its id, a streamed song ([ytSong], the
 * queue's) by its video id.
 */
export const shareNowPlaying = (
  content: Omit<SongShareContent, "links">,
  trackId: string | null,
  ytSong: StreamedShareSong | null,
): void => {
  const track = trackId === null ? null : parseTrackId(trackId);
  openSongShare(
    content,
    undefined,
    track?.kind === "library"
      ? librarySongLinks(track.id)
      : ytSong === null
        ? undefined
        : streamedSongLinks(ytSong),
  );
};
