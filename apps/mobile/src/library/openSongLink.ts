/**
 * Opening a song link shared to Wave (docs/spec.md, "Opening a song link"):
 * the song plays at once as a Magic Queue seeded by it, from the Library's
 * copy when there is one, else streamed, and Now Playing opens. Core decides
 * which links name a song, which copy plays (`songLinkLibraryCopy`,
 * `songLinkPlay`, `trackLinkPlay` for another service's track) and what a
 * link that plays nothing says (`songLinkNotice`, `songLinkNotFound`).
 */
import {
  linkedYtSong,
  readSpotifyTrack,
  songLinkLibraryCopy,
  songLinkNotice,
  songLinkPlay,
  spotifyShortLinkLanding,
  trackLinkPlay,
  type PlaylistLink,
  type SongLink,
  type SongLinkFailure,
  type SongLinkPlay,
  type YtSong,
} from "@wave/core";
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

import { LibraryStore, type SongRow } from "./LibraryStore";
import { appRuntime } from "./runtime";
import { openSongNotFound } from "./SongNotFoundCard";
import { spotifyTransport } from "./spotifyTransport";

/** How long Spotify gets to answer: a malformed id has kept a request open for minutes. */
const SPOTIFY_TIMEOUT_MS = 20_000;

const say = (failure: SongLinkFailure): void => {
  const notice = songLinkNotice(failure, currentLocalisation().language);
  void showMessage(notice.title, notice.message);
};

/** Takes the "Finding song…" toast away, unless another toast took its place. */
const endFinding = (id: number | undefined): void => {
  if (id !== undefined) dismissToast(id);
};

/** What a song link ends in: a play, or what to say instead. */
type Ending =
  SongLinkPlay<YtSong, SongRow> | { readonly play: "failed"; readonly failure: SongLinkFailure };

/** The Library's finder, or one that finds nothing when the Library can't be read. */
const libraryFind = async () => (await currentLibraryFinder().catch(() => null)) ?? (() => null);

/**
 * What a YouTube Music link plays: YouTube Music is asked for the song's
 * radio, whose first song is the song itself (`linkedYtSong`); a video it
 * can't play says the link doesn't open. The Library's copy (the song
 * downloaded from that video, else `libraryFinder`'s) plays when it has one.
 */
const ytMusicEnding = async (videoId: string): Promise<Ending> => {
  const answer = await askYtMusic((ytMusic) => ytMusic.radio({ videoId })).catch(() => null);
  if (answer === null || Result.isFailure(answer))
    return { play: "failed", failure: answer === null ? "failed" : answer.failure.reason };
  const song = linkedYtSong(videoId, answer.success.songs);
  if (song === null) return { play: "failed", failure: "unplayable" };
  const [stored, find] = await Promise.all([
    appRuntime
      .runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.songWithVideo(videoId);
        }),
      )
      .catch(() => null),
    libraryFind(),
  ]);
  return songLinkPlay(song, songLinkLibraryCopy(song, { stored, find }), song);
};

/**
 * Where a Spotify short link lands once followed (`spotifyShortLinkLanding`):
 * a track's id, a playlist, or what to say when it names neither or Spotify
 * is out of reach.
 */
const followShortLink = async (
  url: string,
  signal: AbortSignal,
): Promise<
  | { readonly trackId: string }
  | { readonly playlist: PlaylistLink }
  | { readonly failure: SongLinkFailure }
> => {
  try {
    const response = await fetch(url, { signal });
    const landing = spotifyShortLinkLanding(response.url, await response.text());
    if (landing === null) return { failure: "cantOpen" };
    return landing.kind === "song" ? { trackId: landing.link.trackId } : { playlist: landing.link };
  } catch {
    return { failure: { unread: "unreachable", service: "spotify" } };
  }
};

/**
 * What a Spotify track plays: its title, artists, length and cover read from
 * its embed page (`readSpotifyTrack`, sending Spotify the track id), then the
 * Library's same recording, else YouTube Music's, searched for once in the
 * search allowance (`trackLinkPlay`).
 */
const spotifyEnding = async (trackId: string, signal: AbortSignal): Promise<Ending> => {
  const read = await readSpotifyTrack(trackId, spotifyTransport(signal));
  if (!read.ok) return { play: "failed", failure: { unread: read.reason, service: "spotify" } };
  return trackLinkPlay(read.song, {
    find: await libraryFind(),
    search: (song) => searchRecordingInTurn("songLink", song),
  });
};

/**
 * Plays the song [link] names. Offline it says so and asks nothing. Else a
 * toast says "Finding song…" while the song is found: a Spotify short link is
 * followed first, and one that lands on a playlist opens its import card
 * ([openPlaylist]) instead. The Library's copy plays when it has one, else
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
  const timeout = setTimeout(() => controller.abort(), SPOTIFY_TIMEOUT_MS);
  let ending: Ending;
  try {
    if (link.service === "ytMusic") ending = await ytMusicEnding(link.videoId);
    else if (link.service === "spotify")
      ending = await spotifyEnding(link.trackId, controller.signal);
    else {
      const landing = await followShortLink(link.url, controller.signal);
      if ("playlist" in landing) {
        endFinding(finding);
        openPlaylist(landing.playlist);
        return;
      }
      ending =
        "failure" in landing
          ? { play: "failed", failure: landing.failure }
          : await spotifyEnding(landing.trackId, controller.signal);
    }
  } finally {
    clearTimeout(timeout);
  }
  endFinding(finding);
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
