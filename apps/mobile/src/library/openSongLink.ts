/**
 * Opening a song link shared to Wave (docs/spec.md, "Opening a song link"):
 * the song plays at once as a Magic Queue seeded by it, from the Library's
 * copy when there is one, else streamed, and Now Playing opens. An album or
 * artist link opens its YT Music page instead. Core decides which links name
 * a song, album or artist, which copy plays (`ytMusicLinkPlay`, and
 * `trackLinkPlay` for a Spotify or Deezer track), which page opens
 * (`albumLinkOpening`, `ytAlbumPlaylistOpening`, `artistLinkOpening`,
 * `ytChannelLinkOpening`) and what a link that opens nothing says
 * (`songLinkNotice`, `songLinkNotFound`).
 */
import {
  joinArtists,
  readDeezerArtist,
  readDeezerTrack,
  readSpotifyAlbum,
  readSpotifyArtist,
  readSpotifyTrack,
  songLinkKind,
  songLinkNotice,
  type Catalogue,
  type PlaylistLink,
  type SongLink,
  type SongLinkFailure,
  type SongLinkKind,
  type YtSong,
} from "@wave/core";
import { songLinkEnding, type SongLinkEnding } from "@wave/client/songLinkEnding";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { currentLocalisation } from "@/localisation/localisation";
import { online } from "@/native/waveNative";
import { openNowPlaying } from "@/nowPlaying/sheet";
import { showError, showMessage } from "@/overlay/alert";
import { currentToast, dismissToast, showToast } from "@/overlay/toast";
import { startMagicQueue, startStreamedMagicQueue } from "@/playback/MagicQueue";
import { askYtMusic, searchRecordingInTurn } from "@/ytmusic/askYtMusic";
import { currentLibraryFinder } from "@/ytmusic/libraryFinder";
import { openYtAlbum, openYtArtist } from "@/ytmusic/routes";
import type { YtMusic, YtMusicError } from "@/ytmusic/YtMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";

import { LibraryStore } from "./LibraryStore";
import { type SongRow } from "@wave/client";
import { appRuntime } from "./runtime";
import { deezerTransport, followShortLink, spotifyTransport } from "@wave/client/serviceTransport";
import { openSongNotFound } from "./SongNotFoundCard";

/**
 * How long Spotify or Deezer gets to answer, short link and all: a malformed
 * Spotify id has kept a request open for minutes.
 */
const TRACK_SERVICE_TIMEOUT_MS = 20_000;

const say = (failure: SongLinkFailure): void => {
  const notice = songLinkNotice(failure, currentLocalisation().language);
  void showMessage(notice.title, notice.message);
};

/** Takes the "Finding song…" toast away, unless another toast took its place. */
const endFinding = (id: number | undefined): void => {
  if (id !== undefined) dismissToast(id);
};

/** What a song link ends in: a play, or what to say instead. */
type Ending = SongLinkEnding<YtSong, SongRow>;

/** The Library's finder, or one that finds nothing when the Library can't be read. */
const libraryFind = async () => (await currentLibraryFinder().catch(() => null)) ?? (() => null);

/** The Library song downloaded from the video [videoId], or null (none, or the Library unread). */
const storedSong = (videoId: string): Promise<SongRow | null> =>
  appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        return yield* store.songWithVideo(videoId);
      }),
    )
    .catch(() => null);

/**
 * A YT Music page ([use]) as [read] gives it, or why it wasn't read: YT Music's reason, or
 * `failed` when the request itself was cut short.
 */
const ytPageRead = async <A, R extends { readonly ok: true }>(
  use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, YtMusicError>,
  read: (page: A) => R,
): Promise<R | { readonly ok: false; readonly reason: YtMusicError["reason"] }> => {
  const answer = await askYtMusic(use).catch(() => null);
  if (answer === null) return { ok: false, reason: "failed" };
  return Result.isFailure(answer)
    ? { ok: false, reason: answer.failure.reason }
    : read(answer.success);
};

const linkEnding = (link: SongLink, signal: AbortSignal): Promise<Ending> =>
  songLinkEnding(
    link,
    {
      stored: storedSong,
      find: libraryFind,
      radio: async (videoId) => {
        const answer = await askYtMusic((ytMusic) => ytMusic.radio({ videoId })).catch(() => null);
        if (answer === null) return null;
        return Result.isFailure(answer)
          ? { ok: false, reason: answer.failure.reason }
          : { ok: true, songs: answer.success.songs };
      },
      search: (song) => searchRecordingInTurn("songLink", song),
      spotify: (id, abort) => readSpotifyTrack(id, spotifyTransport(abort)),
      deezer: (id, abort) => readDeezerTrack(id, deezerTransport(abort)),
      follow: (url, body, abort) => followShortLink(url, { body }, abort),
      spotifyAlbum: (id, abort) => readSpotifyAlbum(id, spotifyTransport(abort)),
      searchAlbums: async (query) => {
        const answer = await askYtMusic((ytMusic) =>
          withSearchTurn("songLink", query, ytMusic.searchAlbums(query)),
        ).catch(() => null);
        return answer === null || Result.isFailure(answer) ? null : answer.success;
      },
      pages: {
        albumPlaylist: (playlistId) =>
          ytPageRead(
            (ytMusic) => ytMusic.playlist(playlistId),
            (playlist) => ({ ok: true as const, playlist }),
          ),
        artistPage: (channelId) =>
          ytPageRead(
            (ytMusic) => ytMusic.artist(channelId),
            (page) => ({ ok: true as const, name: page.name }),
          ),
        spotifyArtist: (id, abort) => readSpotifyArtist(id, spotifyTransport(abort)),
        deezerArtist: (id, abort) => readDeezerArtist(id, deezerTransport(abort)),
        searchArtists: async (query) => {
          const answer = await askYtMusic((ytMusic) =>
            withSearchTurn("songLink", query, ytMusic.searchArtists(query)),
          ).catch(() => null);
          return answer === null || Result.isFailure(answer) ? null : answer.success;
        },
      },
    },
    signal,
  );

/** What a link says by what it opens: offline, and while it's looked for. */
const LINK_KINDS = {
  song: { offline: "offline", finding: "findingSong" },
  album: { offline: "albumOffline", finding: "findingAlbum" },
  artist: { offline: "artistOffline", finding: "findingArtist" },
} as const satisfies Record<
  SongLinkKind,
  { readonly offline: SongLinkFailure; readonly finding: keyof Catalogue["imports"] }
>;

/**
 * Plays the song [link] names. Offline it says so and asks nothing. Else a
 * toast says "Finding song…" while the song is found: a Spotify or Deezer
 * short link is followed first, and a Spotify one that lands on a playlist
 * opens its import card ([openPlaylist]) instead. An album link (YT Music's page or playlist,
 * Spotify's, or a short link that lands on one) opens the album's YT Music page instead, with
 * "Finding album…" while it's looked for, and an artist link (a YouTube channel, a Spotify or
 * Deezer artist) the artist's, with "Finding artist…". The Library's copy plays when it has one,
 * else the YT Music song streams, each with related songs after it (a Magic Queue
 * session Up Next heads "Related · from <song>"; the previous queue goes),
 * and Now Playing opens. A song found nowhere opens the Couldn't find
 * card; anything else that plays nothing says why. YT Music off was said
 * before this.
 */
export const openSongLink = async (
  link: SongLink,
  { openPlaylist }: { readonly openPlaylist: (link: PlaylistLink) => void },
): Promise<void> => {
  const { strings } = currentLocalisation();
  const kind = LINK_KINDS[songLinkKind(link)];
  if (!online()) {
    say(kind.offline);
    return;
  }
  void showToast(strings.imports[kind.finding]);
  const finding = currentToast.get()?.id;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRACK_SERVICE_TIMEOUT_MS);
  let ending: Ending;
  try {
    ending = await linkEnding(link, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  endFinding(finding);
  if ("playlist" in ending) {
    openPlaylist(ending.playlist);
    return;
  }
  if ("album" in ending) {
    const { read } = ending;
    openYtAlbum(
      ending.album,
      read === null
        ? undefined
        : { title: read.title, line: joinArtists(read.artists), artworkUrl: read.artworkUrl },
    );
    return;
  }
  if ("artist" in ending) {
    openYtArtist(ending.artist, ending.name ?? undefined);
    return;
  }
  if (ending.play === "failed") {
    say(ending.failure);
    return;
  }
  if (ending.play === "notFound") {
    openSongNotFound(ending.song);
    return;
  }
  const start =
    ending.from === "library"
      ? startMagicQueue(ending.seed, [ending.track], [], undefined, { plainPlay: true })
      : startStreamedMagicQueue(ending.song, { plainPlay: true });
  try {
    await appRuntime.runPromise(start);
    openNowPlaying();
  } catch (error) {
    void showError(strings.playbackText.couldntPlayTheSong, error);
  }
};
