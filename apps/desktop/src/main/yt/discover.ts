/**
 * Discover on the desktop (docs/spec.md, Discover): the Magic Queue row's songs to start a Magic
 * Queue from, and Artist mixes of songs the owner doesn't know yet, each grown from one of their
 * most played artists' YouTube Music radio (Core's `artistMixSeeds` and `discoverMixSongs`).
 * Mixes are built once a day; offline, or when YouTube Music fails, there are none and the window
 * shows its quiet line.
 *
 * The phone's Genre mixes, similar and chart artists, Discover's level and its refresh aren't on
 * the desktop yet.
 */
import {
  artistMixSeeds,
  discoverMix,
  discoverMixSongs,
  randomMagicQueuePicks,
  type DiscoverLibraryArtist,
  type PlayedSeedArtist,
  type YtAlbumSong,
} from "@wave/core";

import type { YtStatus } from "../../shared/yt.ts";
import type { YtPagesShape } from "./ytPages.ts";

export interface DiscoverDeps {
  /** The owner's most played artists, most played first. */
  readonly played: () => readonly PlayedSeedArtist[];
  /** The Library's songs with a file, by id, and its artists with their song counts. */
  readonly library: () => {
    readonly trackIds: readonly number[];
    readonly artists: readonly DiscoverLibraryArtist[];
  };
  /** Whether the owner knows [song]: the Library has it. */
  readonly known: (song: YtAlbumSong) => boolean;
  readonly pages: Pick<YtPagesShape, "findArtist" | "artistRadio">;
  /** Today's date, local time: a new day builds new mixes. */
  readonly today: () => string;
  readonly random?: () => number;
}

/** One Artist mix: its seed artist's name and its songs, in the radio's order. */
export interface DesktopMix {
  readonly id: string;
  readonly name: string;
  readonly songs: readonly YtAlbumSong[];
}

export interface DiscoverShape {
  /** The Magic Queue row: nine Library songs at random, by id. */
  readonly picks: () => readonly number[];
  /** Today's Artist mixes, built on the first call of the day. */
  readonly mixes: () => Promise<{ readonly status: YtStatus; readonly mixes: readonly DesktopMix[] }>;
  /** One of today's mixes, by its id. */
  readonly mix: (id: string) => DesktopMix | undefined;
}

export const createDiscover = (deps: DiscoverDeps): DiscoverShape => {
  const random = deps.random ?? Math.random;
  let built: { readonly day: string; readonly mixes: readonly DesktopMix[] } | null = null;
  let building: Promise<{ readonly status: YtStatus; readonly mixes: readonly DesktopMix[] }> | null =
    null;
  const build = async () => {
    const day = deps.today();
    const seeds = artistMixSeeds(
      { played: deps.played(), library: deps.library().artists },
      random,
    );
    const statuses: YtStatus[] = [];
    // Each radio is read in turn, so a mix leaves out the songs an earlier one has.
    const mixes: DesktopMix[] = [];
    const taken = new Set<string>();
    for (const seed of seeds) {
      const found =
        seed.browseId === undefined
          ? await deps.pages.findArtist(seed.name)
          : { status: "ok" as const, browseId: seed.browseId };
      if (found.browseId === null) {
        statuses.push(found.status);
        continue;
      }
      const radio = await deps.pages.artistRadio(found.browseId);
      statuses.push(radio.status);
      const mix = discoverMix(
        seed,
        discoverMixSongs([radio.songs.map((song) => ({ ...song, video: false }))], {
          known: deps.known,
          taken,
        }),
      );
      // Fewer than ten new songs aren't a mix.
      if (mix === null) continue;
      const { songs } = mix;
      for (const song of songs) taken.add(song.videoId);
      mixes.push({ id: seed.id, name: seed.name, songs });
    }
    const status: YtStatus =
      mixes.length > 0
        ? "ok"
        : (statuses.find((s) => s === "offline") ??
          statuses.find((s) => s === "disabled") ??
          statuses.find((s) => s === "failed") ??
          "ok");
    // A day with nothing read because of the connection is tried again on the next call.
    if (status === "ok") built = { day, mixes };
    return { status, mixes };
  };
  return {
    picks: () =>
      randomMagicQueuePicks({ trackIds: deps.library().trackIds, videoIds: [] }, random).filter(
        (id): id is number => typeof id === "number",
      ),
    mixes: async () => {
      if (built?.day === deps.today()) return { status: "ok", mixes: built.mixes };
      building ??= build().finally(() => {
        building = null;
      });
      return building;
    },
    mix: (id) => built?.mixes.find((mix) => mix.id === id),
  };
};
