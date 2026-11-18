/**
 * Opening a song link shared to Wave (docs/spec.md, "Opening a song link"):
 * the song plays at once as a Magic Queue seeded by it, from the Library's
 * copy when there is one, else streamed, and Now Playing opens. Core decides
 * which links name a song, which copy plays (`ytMusicLinkPlay`, and
 * `trackLinkPlay` for a Spotify or Deezer track) and what a link that plays
 * nothing says (`songLinkNotice`, `songLinkNotFound`).
 */
import {
  readDeezerTrack,
  readSpotifyTrack,
  songLinkNotice,
  type PlaylistLink,
  type SongLink,
  type SongLinkFailure,
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
    },
    signal,
  );

/**
 * Plays the song [link] names. Offline it says so and asks nothing. Else a
 * toast says "Finding song…" while the song is found: a Spotify or Deezer
 * short link is followed first, and a Spotify one that lands on a playlist
 * opens its import card ([openPlaylist]) instead. The Library's copy plays when it has one, else
 * the YT Music song streams, each as its Magic Queue (the previous queue
 * goes), and Now Playing opens. A song found nowhere opens the Couldn't find
 * card; anything else that plays nothing says why. YT Music off was said
 * before this.
 */
export const openSongLink = async (
  link: SongLink,
  { openPlaylist }: { readonly openPlaylist: (link: PlaylistLink) => void },
): Promise<void> => {
  const { strings } = currentLocalisation();
  if (!online()) {
    say("offline");
    return;
  }
  void showToast(strings.imports.findingSong);
  const finding = currentToast.get()?.id;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRACK_SERVICE_TIMEOUT_MS);
  let ending: Ending | { readonly playlist: PlaylistLink };
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
      ? startMagicQueue(ending.seed, [ending.track])
      : startStreamedMagicQueue(ending.song);
  try {
    await appRuntime.runPromise(start);
    openNowPlaying();
  } catch (error) {
    void showError(strings.playbackText.couldntStartTheMagicQueue, error);
  }
};
