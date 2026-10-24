/**
 * The radios a playlist's suggestions read (docs/spec.md, Playlist
 * recommendations): those of 3 of its songs, drawn per renewal and kept apart
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
import * as Effect from "effect/Effect";
import { Storage } from "expo-sqlite/kv-store";

import type { SongRadioSeed } from "@/playback/songRadioSession";
import { YtMusic } from "@/ytmusic/YtMusic";

import { createAppSongRadioReaders } from "@/playback/songRadioSetup";

import type { LibraryStore } from "./LibraryStore";

/** Each playlist's latest seed draws, on the phone (not synced). */
const SEED_DRAWS = "playlistSuggestions.seedDraws";

const radioReaders = createAppSongRadioReaders("Playlist suggestions");

/** [track]'s radio, under the id the Magic Queue's list seeds use, so both share its cached page. */
const radioSeed = (track: PlaylistRecommendationTrack): SongRadioSeed => ({
  id: `song:${track.id}`,
  title: track.title,
  artists: track.artists,
  durationMs: track.durationMs,
  ...(track.videoId === "" ? {} : { videoId: track.videoId }),
});

/**
 * Draws playlist [playlistId]'s next seeds and saves its recent history so
 * subsequent renewals avoid them while other songs remain.
 */
export const playlistSuggestionSeeds = (
  playlistId: number,
  playlist: readonly PlaylistRecommendationTrack[],
): PlaylistRecommendationTrack[] => {
  let history = parsePlaylistSeedHistory(null);
  try {
    history = parsePlaylistSeedHistory(Storage.getItemSync(SEED_DRAWS));
  } catch {
    // Unreadable history: the draw just doesn't avoid earlier seeds.
  }
  const recent = history.get(playlistId) ?? [];
  const draw = drawPlaylistSeeds(playlist, { recent, random: Math.random });
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
    const readers = radioReaders(yield* YtMusic, yield* Effect.context<LibraryStore>());
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
