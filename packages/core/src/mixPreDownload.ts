/**
 * What Wave fetches ahead on Wi-Fi (docs/spec.md, YT Music, Wi-Fi
 * pre-download): the start of each of the day's mixes goes into the audio
 * cache, so playing a mix on mobile data starts without spending data.
 */

import type { BlendedDiscoverMix } from "./discoverMixLevels.ts";

/** How many of each mix's streaming songs are fetched ahead. */
export const MIX_PRE_DOWNLOAD_SONGS = 5;

/**
 * The videos to fetch ahead for [sections]' mixes (each section's mixes as
 * its level blends them, as Home shows them): each mix's first [perMix]
 * songs that stream, in its order, the mixes taking turns (every mix's
 * first song, then every mix's second...), so a run stopped early has
 * started every mix. A song in two mixes is fetched once, at its first turn.
 */
export const mixPreDownload = (
  sections: readonly (readonly BlendedDiscoverMix[])[],
  perMix: number = MIX_PRE_DOWNLOAD_SONGS,
): string[] => {
  const starts = sections
    .flat()
    .map((mix) =>
      mix.songs
        .flatMap((song) => (song.source === "stream" ? [song.song.videoId] : []))
        .slice(0, perMix),
    );
  const videos = new Set<string>();
  for (let turn = 0; turn < perMix; turn++) {
    for (const start of starts) {
      const video = start[turn];
      if (video !== undefined) videos.add(video);
    }
  }
  return [...videos];
};
