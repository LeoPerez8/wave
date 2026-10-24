/** Discover mixes rank only the songs their radios brought; familiar blending stays separate. */
import { mixSeedArtists, type DiscoverMixSeed } from "./discoverMixes.ts";
import type { DiscoverMixRead } from "./discoverMixRadios.ts";
import type { GenreProfile } from "./genreAffinity.ts";
import {
  rankRadioSongs,
  type RadioRankingSources,
  type RadioRankingOptions,
} from "./radioRanking.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

export const rankedDiscoverMixRead = (
  seed: DiscoverMixSeed,
  sources: Pick<RadioRankingSources, "pages" | "taste" | "profileOf" | "popularityOf">,
  options: RadioRankingOptions & { readonly profile?: GenreProfile | null } = {},
): DiscoverMixRead<YtAlbumSong & { readonly video: boolean }> => ({
  seed,
  radio: rankRadioSongs(
    {
      artists: mixSeedArtists(seed).map((artist) => artist.name),
      profile: options.profile ?? null,
    },
    {
      pages: sources.pages.map((page) => ({
        ...page,
        songs: page.songs.filter((song) => !("video" in song && song.video === true)),
      })),
      ...(sources.taste === undefined ? {} : { taste: sources.taste }),
      ...(sources.profileOf === undefined ? {} : { profileOf: sources.profileOf }),
      ...(sources.popularityOf === undefined ? {} : { popularityOf: sources.popularityOf }),
    },
    options,
  ).flatMap((candidate) => (candidate.song === null ? [] : [{ ...candidate.song, video: false }])),
});
