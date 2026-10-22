import { finishSteps } from "./buildSteps.ts";
/**
 * A mix section's mixes out of its seeds' radios read at the same time
 * (docs/spec.md, "Artist mixes", "Genre mixes"): the app reads every seed's
 * radios at once, then the seeds take their songs in seed order, so a new
 * song two radios found stays in the earlier seed's mix and a familiar song
 * in the earlier seed's share, as when the seeds were read one after another.
 */

import { discoverMixFamiliarPoolSteps, type DiscoverMixPoolSources } from "./discoverMixLevels.ts";
import {
  discoverMix,
  discoverMixSongsSteps,
  type DiscoverLibrarySong,
  type DiscoverMix,
  type DiscoverMixSeed,
  type DiscoverRadioSong,
} from "./discoverMixes.ts";
import type { MixAffinity } from "./genreAffinity.ts";

/** A radio song as a mix keeps it. */
type MixRadioSong = DiscoverRadioSong & { readonly albumId: string | null };

/** A seed's radios as read: interleaved (`interleaveRadios`), every page read. */
export interface DiscoverMixRead<S extends MixRadioSong> {
  readonly seed: DiscoverMixSeed;
  readonly radio: readonly S[];
  /** Whether a song suits the seed's genres (`mixAffinity`); absent: every song does. */
  readonly affinity?: (song: S) => MixAffinity;
  /**
   * The songs its familiar share looks at first, in order (the familiar
   * songs its radios played); absent: [radio]. A mix built from the catalog
   * passes the songs its seed's radios brought, as a radio read would have.
   */
  readonly familiar?: readonly S[];
}

/**
 * The mixes [reads] make, in seed order (a seed whose radio couldn't be read
 * is left out of [reads]): each seed's new songs (`discoverMixSongs`) less
 * those an earlier mix has, its familiar share (`discoverMixFamiliarPool`)
 * less what an earlier share has. A seed left with fewer than ten new songs
 * makes no mix, and takes nothing from the seeds after it. A refresh passes
 * the new songs the section showed today as [avoid] (`mixRefreshAvoid`).
 */
export const discoverMixesOfRadios = <S extends MixRadioSong, L extends DiscoverLibrarySong>(
  reads: readonly DiscoverMixRead<S>[],
  options: Pick<DiscoverMixPoolSources<L>, "known" | "library"> & {
    readonly avoid?: ReadonlySet<string>;
  },
): DiscoverMix[] => finishSteps(discoverMixesOfRadiosSteps(reads, options));

export function* discoverMixesOfRadiosSteps<S extends MixRadioSong, L extends DiscoverLibrarySong>(
  reads: readonly DiscoverMixRead<S>[],
  {
    known,
    library,
    avoid,
  }: Pick<DiscoverMixPoolSources<L>, "known" | "library"> & {
    readonly avoid?: ReadonlySet<string>;
  },
): Generator<void, DiscoverMix[]> {
  const taken = new Set<string>();
  const takenFamiliar = { tracks: new Set<number>(), videos: new Set<string>() };
  const mixes: DiscoverMix[] = [];
  for (const { seed, radio, affinity, familiar: played = radio } of reads) {
    const kept = yield* discoverMixSongsSteps([radio], {
      known: known.known,
      taken,
      ...(avoid === undefined ? {} : { avoid }),
      ...(affinity === undefined ? {} : { affinity }),
    });
    const familiar = yield* discoverMixFamiliarPoolSteps(seed, {
      radio: played,
      known,
      library,
      taken: takenFamiliar,
      length: kept.length,
    });
    const mix = discoverMix(seed, kept, familiar);
    if (mix === null) continue;
    mixes.push(mix);
    for (const song of mix.songs) taken.add(song.videoId);
    for (const song of familiar) {
      if (song.source === "library") takenFamiliar.tracks.add(song.track.id);
      else takenFamiliar.videos.add(song.song.videoId);
    }
  }
  return mixes;
}
