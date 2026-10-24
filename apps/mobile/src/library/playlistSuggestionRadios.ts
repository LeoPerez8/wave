/**
 * The radios a playlist's suggestions read (docs/spec.md, Playlist
 * recommendations): those of 3 of its songs, drawn per visit and kept apart
 * per playlist, each read as the Magic Queue reads a song's radio (#642).
 */
import {
  drawPlaylistSeeds,
  parsePlaylistSeedHistory,
  playlistSeedHistoryWith,
  storedPlaylistSeedHistory,
  type PlaylistRecommendationTrack,
  type RadioRankingPage,
} from "@wave/core";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Storage } from "expo-sqlite/kv-store";

import { artistRadio } from "@/home/ytArtistPage";
import { withNetworkLog } from "@/lib/networkMeter";
import { appLog } from "@/log/appLog";
import { createSongRadioReaders } from "@/playback/songRadioReaders";
import { createSongRadioSession, type SongRadioSeed } from "@/playback/songRadioSession";
import { noteRadioNow } from "@/ytmusic/candidateCatalog";
import { createRadioPageCatalog } from "@/ytmusic/radioPageCatalog";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";

import type { LibraryStore } from "./LibraryStore";

/** Each playlist's latest seed draws, on the phone (not synced). */
const SEED_DRAWS = "playlistSuggestions.seedDraws";

const pages = createRadioPageCatalog({
  read: () => Storage.getItemSync("candidateCatalog.radioPages"),
  write: (value) => Storage.setItemSync("candidateCatalog.radioPages", value),
});
let services: {
  readonly yt: YtMusic["Service"];
  readonly context: Context.Context<LibraryStore>;
} | null = null;

/** Every suggestion radio read so far, by visit and radio; each saves its pages and notes its artists' radio. */
const readers = createSongRadioReaders((seed: SongRadioSeed) => {
  const { yt, context } = services!;
  return createSongRadioSession(seed, {
    cached: pages.get(seed.id),
    radio: (videoId) => yt.radio({ videoId }),
    search: (query) =>
      withSearchTurn("discover", query, yt.searchSongs(query)).pipe(
        Effect.map((page) => page.songs),
      ),
    artist: (name) =>
      artistRadio({ name }).pipe(Effect.provide(context), Effect.provideService(YtMusic, yt)),
    more: (token) => yt.radioMore(token),
    measure: (read) =>
      withNetworkLog("Playlist suggestions radio", read, (page) =>
        page === null ? "no radio" : `${page.songs.length} songs`,
      ),
    save: (page) =>
      Effect.gen(function* () {
        pages.put(seed.id, page);
        for (const artist of seed.artists)
          yield* noteRadioNow(artist, page.songs).pipe(Effect.provide(context));
      }),
    fallback: (name) =>
      appLog(
        "info",
        "WaveRecommendations",
        `Playlist suggestions: no song match for ${seed.title}; using ${name}'s artist radio`,
      ),
  });
});

/** [track]'s radio, under the id the Magic Queue's list seeds use, so both share its cached page. */
const radioSeed = (track: PlaylistRecommendationTrack): SongRadioSeed => ({
  id: `song:${track.id}`,
  title: track.title,
  artists: track.artists,
  durationMs: track.durationMs,
  ...(track.videoId === "" ? {} : { videoId: track.videoId }),
});

/**
 * Playlist [playlistId]'s seeds: [kept] while they're all still in
 * [playlist], else a new draw (`drawPlaylistSeeds`), saved in the playlist's
 * history so its next draws avoid it.
 */
export const playlistSuggestionSeeds = (
  playlistId: number,
  playlist: readonly PlaylistRecommendationTrack[],
  kept: readonly PlaylistRecommendationTrack[],
): PlaylistRecommendationTrack[] => {
  let history = parsePlaylistSeedHistory(null);
  try {
    history = parsePlaylistSeedHistory(Storage.getItemSync(SEED_DRAWS));
  } catch {
    // Unreadable history: the draw just doesn't avoid earlier seeds.
  }
  const recent = history.get(playlistId) ?? [];
  const draw = drawPlaylistSeeds(playlist, { recent, random: Math.random, kept });
  if (draw.recent !== recent)
    try {
      Storage.setItemSync(
        SEED_DRAWS,
        storedPlaylistSeedHistory(playlistSeedHistoryWith(history, playlistId, draw.recent)),
      );
    } catch {
      // Not saved: the next visit may draw these seeds again.
    }
  return draw.seeds;
};

/**
 * [seeds]' radios for visit [visitId], all at once: a cached first page at
 * once (its live refresh in the background), else the live first page within
 * 8 s; offline only cached pages. Continuations are read only when [low].
 * Music videos are left out.
 */
export const playlistSuggestionRadios = (
  visitId: string,
  seeds: readonly PlaylistRecommendationTrack[],
  when: { readonly online: boolean; readonly low: boolean },
) =>
  Effect.gen(function* () {
    services = { yt: yield* YtMusic, context: yield* Effect.context<LibraryStore>() };
    const read = yield* readers.read(visitId, seeds.map(radioSeed), when);
    return read.flatMap(({ seed, page }): RadioRankingPage[] =>
      page === null
        ? []
        : [
            {
              id: seed.id,
              artists: seed.artists,
              songs: page.songs.filter((song) => song.video !== true),
            },
          ],
    );
  });
