/**
 * Opening a song link shared to Wave (docs/spec.md, "Opening a song link"):
 * the song plays at once as a Magic Queue seeded by it, from the Library's
 * copy when there is one, else streamed, and Now Playing opens. Core decides
 * which links name a song, which copy plays (`ytMusicLinkPlay`, and
 * `trackLinkPlay` for a Spotify or Deezer track) and what a link that plays
 * nothing says (`songLinkNotice`, `songLinkNotFound`).
 */
import {
  deezerShortLinkLanding,
  readDeezerTrack,
  readSpotifyTrack,
  songLinkNotice,
  spotifyShortLinkLanding,
  trackLinkPlay,
  ytMusicLinkPlay,
  type PlaylistLink,
  type SongLink,
  type SongLinkFailure,
  type SongLinkPlay,
  type TrackRead,
  type TrackService,
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
import { deezerTransport, followShortLink, spotifyTransport } from "./serviceTransport";
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
type Ending =
  SongLinkPlay<YtSong, SongRow> | { readonly play: "failed"; readonly failure: SongLinkFailure };

const failed = (failure: SongLinkFailure): Ending => ({ play: "failed", failure });

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
 * What a YouTube Music link plays (`ytMusicLinkPlay`): the Library's song
 * downloaded from that video, with nothing asked online; else the song as
 * the first page of its radio names it, from the Library's same recording
 * (`libraryFinder`) or streamed.
 */
const ytMusicEnding = async (videoId: string): Promise<Ending> => {
  const [stored, find] = await Promise.all([storedSong(videoId), libraryFind()]);
  return ytMusicLinkPlay(videoId, {
    stored,
    find,
    radio: async () => {
      const answer = await askYtMusic((ytMusic) => ytMusic.radio({ videoId })).catch(() => null);
      if (answer === null) return null;
      return Result.isFailure(answer)
        ? { ok: false, reason: answer.failure.reason }
        : { ok: true, songs: answer.success.songs };
    },
  });
};

/** Where a service's short link landed: a track's id, or a playlist (Spotify's). */
type Landing = { readonly trackId: string } | { readonly playlist: PlaylistLink };

/** A service whose song links name a track Wave reads: how its short links land and its tracks are read. */
interface TrackSource {
  readonly service: TrackService;
  /**
   * Whether a short link's landing page is downloaded: Spotify's (Branch's
   * page for apps) names the track only in its body, while Deezer's
   * redirects end on the track's own address, so it is followed with `HEAD`.
   */
  readonly landingBody: boolean;
  /** What a short link that landed on [url], answering [body], names; null for neither. */
  readonly landing: (url: string, body: string) => Landing | null;
  /** Reads the track [trackId] from the service, sending it the id and nothing else. */
  readonly read: (trackId: string, signal: AbortSignal) => Promise<TrackRead>;
}

const SPOTIFY: TrackSource = {
  service: "spotify",
  landingBody: true,
  landing: (url, body) => {
    const landing = spotifyShortLinkLanding(url, body);
    if (landing === null) return null;
    return landing.kind === "song" ? { trackId: landing.link.trackId } : { playlist: landing.link };
  },
  read: (trackId, signal) => readSpotifyTrack(trackId, spotifyTransport(signal)),
};

const DEEZER: TrackSource = {
  service: "deezer",
  landingBody: false,
  landing: (url) => {
    const landing = deezerShortLinkLanding(url);
    return landing === null ? null : { trackId: landing.trackId };
  },
  read: (trackId, signal) => readDeezerTrack(trackId, deezerTransport(signal)),
};

/**
 * What [source]'s track [trackId] plays: its title, artists, length and
 * cover read from the service, then the Library's same recording, else
 * YouTube Music's, searched for once in the search allowance
 * (`trackLinkPlay`).
 */
const trackEnding = async (
  source: TrackSource,
  trackId: string,
  signal: AbortSignal,
): Promise<Ending> => {
  const read = await source.read(trackId, signal);
  if (!read.ok) return failed({ unread: read.reason, service: source.service });
  return trackLinkPlay(read.song, {
    find: await libraryFind(),
    search: (song) => searchRecordingInTurn("songLink", song),
  });
};

/**
 * What [source]'s short link [url] ends in, followed first: its track's
 * play, the playlist it lands on, "Can't open this" when it names neither,
 * or the service out of reach.
 */
const shortLinkEnding = async (
  source: TrackSource,
  url: string,
  signal: AbortSignal,
): Promise<Ending | { readonly playlist: PlaylistLink }> => {
  let landing: Landing | null;
  try {
    const landed = await followShortLink(url, { body: source.landingBody }, signal);
    landing = source.landing(landed.url, landed.body);
  } catch {
    return failed({ unread: "unreachable", service: source.service });
  }
  if (landing === null) return failed("cantOpen");
  return "trackId" in landing ? trackEnding(source, landing.trackId, signal) : landing;
};

/**
 * What [link] ends in, a short link followed first: a play, what to say, or
 * the playlist a Spotify short link landed on.
 */
const linkEnding = async (
  link: SongLink,
  signal: AbortSignal,
): Promise<Ending | { readonly playlist: PlaylistLink }> => {
  switch (link.service) {
    case "ytMusic":
      return ytMusicEnding(link.videoId);
    case "spotify":
      return trackEnding(SPOTIFY, link.trackId, signal);
    case "deezer":
      return trackEnding(DEEZER, link.trackId, signal);
    case "spotifyShort":
      return shortLinkEnding(SPOTIFY, link.url, signal);
    case "deezerShort":
      return shortLinkEnding(DEEZER, link.url, signal);
  }
};

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
