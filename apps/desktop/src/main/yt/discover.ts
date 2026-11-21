/**
 * Discover on the desktop (docs/spec.md, Discover): the Magic Queue row's songs to start a Magic
 * Queue from, and the two mix rows, Artist mixes and Genre mixes. Seeds, ranking, the familiar
 * share and the blend at Discover's level are Core's, as the phone builds them
 * (`artistMixSeeds`, `genreMixSeeds`, `rankedDiscoverMixes`, `blendDiscoverMix`). Mixes are built
 * once a day; a move of Discover's sliders builds them again from the day's seeds and radios,
 * with no request. Offline, with YT Music off or when YouTube Music fails there are none.
 *
 * The phone's similar and chart artists, its refresh by pull and its saved mixes aren't on the
 * desktop yet: mixes live for the run.
 */
import {
  artistMixSeeds,
  blendDiscoverMix,
  DEFAULT_DISCOVER_MIX_LEVEL,
  DEFAULT_MIX_SLIDERS,
  finishSteps,
  discoverMixName,
  discoverMixRowsToBuild,
  genreMixSeeds,
  libraryFinder,
  libraryMixProfilesSteps,
  mixSeedArtists,
  placeDiscoverMixSongs,
  randomMagicQueuePicks,
  type MagicQueueSeedId,
  rankedDiscoverMixes,
  type BlendedDiscoverMix,
  type DiscoverLibraryArtist,
  type DiscoverLibrarySong,
  type DiscoverMixSeed,
  type DiscoverRowId,
  type MixRowId,
  type DiscoverSongPlays,
  type MixedSong,
  type PlayedSeedArtist,
  type YtAlbumSong,
  type YtSong,
} from "@wave/core";

import type { YtStatus } from "../../shared/yt.ts";
import type { DiscoverSettings } from "../../shared/ytPages.ts";
import type { YtPagesShape, YtRadioRead } from "./ytPages.ts";

export interface DiscoverDeps {
  /** The owner's most played artists, most played first. */
  readonly played: () => readonly PlayedSeedArtist[];
  /**
   * The Library's songs with a file: their ids, its artists with their song counts, and, for
   * the mixes, the songs with their genre tags and counted plays.
   */
  readonly library: () => {
    readonly trackIds: readonly number[];
    readonly artists: readonly DiscoverLibraryArtist[];
    readonly songs?: readonly DiscoverLibrarySong[];
    readonly plays?: readonly DiscoverSongPlays[];
  };
  /**
   * The YT Music entries of the owner's playlists, by video id, each once and none the Library
   * has as a file (Core's `MagicQueuePool`); absent, none.
   */
  readonly entryVideoIds?: () => readonly string[];
  /** Whether the owner knows [song]: the Library has it. */
  readonly known: (song: YtSong) => boolean;
  readonly pages: Pick<YtPagesShape, "findArtist" | "artistRadio">;
  /** Today's date, local time: a new day builds new mixes. */
  readonly today: () => string;
  /** The system's connection; absent, online. */
  readonly online?: () => boolean;
  /** Whether YT Music is on; absent, on. */
  readonly enabled?: () => boolean;
  readonly random?: () => number;
  /** Discover's sliders as kept on this computer; absent, the defaults. */
  readonly readSettings?: () => DiscoverSettings;
  readonly saveSettings?: (value: DiscoverSettings) => void;
  /** Discover's rows Home shows, in order (Core's `parseHomeArrangement`); absent, all three. */
  readonly rows?: () => readonly DiscoverRowId[];
  /** Whether the Library still has the song [id] as a file; absent, the `library` ids. */
  readonly track?: (id: number) => boolean;
  /** The Library song [song] is, by id, once it's a file (a download); absent, none. */
  readonly find?: (song: YtAlbumSong) => number | null;
}

/** A song of a mix as its page lists it and it plays: a Library song by id, or one that streams. */
export type PlacedMixSong = MixedSong<YtAlbumSong, number>;

/** One mix as Discover's level plays it, named after its seed: an artist or a genre family. */
export interface DesktopMix extends BlendedDiscoverMix {
  readonly name: string;
  readonly row: MixRowId;
}

interface MixesRead {
  readonly status: YtStatus;
  readonly mixes: readonly DesktopMix[];
}

export interface DiscoverShape {
  /** Discover's New music level, Genre faithfulness and Popularity. */
  readonly settings: () => DiscoverSettings;
  /** Keeps [value]; the next `mixes` blends and ranks by it. */
  readonly setSettings: (value: DiscoverSettings) => void;
  /**
   * The Magic Queue row: nine seeds at random from the Library's songs (ids) and, with YT Music
   * on, the playlists' YT Music entries (video ids).
   */
  readonly picks: () => readonly MagicQueueSeedId[];
  /**
   * Today's mixes of the rows Home shows, Artist mixes first, built on the first call of the
   * day. A row Home doesn't show isn't built and reads no radio.
   */
  readonly mixes: () => Promise<MixesRead>;
  /** One of today's mixes, by its id. */
  readonly mix: (id: string) => DesktopMix | undefined;
  /**
   * Today's mix [id]'s songs as its page lists and plays them (Core's `placeDiscoverMixSongs`):
   * its Library songs among its new ones, a new song the Library has since as its file, a
   * Library song no longer there left out; undefined for a mix that's gone.
   */
  readonly placed: (id: string) => readonly PlacedMixSong[] | undefined;
}

type SeedArtist = Pick<DiscoverMixSeed, "name" | "browseId">;

export const createDiscover = (deps: DiscoverDeps): DiscoverShape => {
  const random = deps.random ?? Math.random;
  let settings: DiscoverSettings = deps.readSettings?.() ?? {
    level: DEFAULT_DISCOVER_MIX_LEVEL,
    ...DEFAULT_MIX_SLIDERS,
  };
  /** The day's seeds, a list per row, and the radios read for them: a slider move reuses both. */
  let day: {
    readonly date: string;
    readonly seeds: Map<MixRowId, readonly DiscoverMixSeed[]>;
    readonly radios: Map<string, Promise<YtRadioRead>>;
  } | null = null;
  let built: {
    readonly date: string;
    readonly settings: DiscoverSettings;
    readonly rows: string;
    readonly mixes: readonly DesktopMix[];
  } | null = null;
  let building: {
    readonly settings: DiscoverSettings;
    readonly rows: string;
    readonly read: Promise<MixesRead>;
  } | null = null;

  const shownRows = (): MixRowId[] =>
    discoverMixRowsToBuild(deps.rows?.() ?? ["magic-queue", "artist-mixes", "genre-mixes"], {
      empty: false,
    });

  const build = async (
    using: DiscoverSettings,
    rowIds: readonly MixRowId[],
  ): Promise<MixesRead> => {
    const date = deps.today();
    if (day?.date !== date) day = { date, seeds: new Map(), radios: new Map() };
    const today = day;
    const local = deps.library();
    const library = {
      artists: local.artists,
      songs: local.songs ?? [],
      ...(local.plays === undefined ? {} : { plays: local.plays }),
    };
    const { profileOf } = finishSteps(libraryMixProfilesSteps(library));
    const seedsOf = (row: MixRowId) =>
      today.seeds.get(row) ??
      (row === "artist-mixes"
        ? artistMixSeeds({ played: deps.played(), library: library.artists }, random)
        : genreMixSeeds({ ...library, profileOf }));
    const rows = rowIds.map((row) => ({ row, seeds: seedsOf(row) }));
    const statuses: YtStatus[] = [];
    // Both rows may grow from the same artist: their radio is read once a day.
    const radioOf = (artist: SeedArtist): Promise<YtRadioRead> => {
      const key = artist.browseId ?? artist.name;
      const kept = today.radios.get(key);
      if (kept !== undefined) return kept;
      const read = (async (): Promise<YtRadioRead> => {
        const found =
          artist.browseId === undefined
            ? await deps.pages.findArtist(artist.name)
            : { status: "ok" as const, browseId: artist.browseId };
        return found.browseId === null
          ? { status: found.status, songs: [], continuation: null }
          : deps.pages.artistRadio(found.browseId);
      })();
      today.radios.set(key, read);
      // A radio that couldn't be read is asked again by the next build.
      void read.then((radio) => {
        if (radio.status !== "ok") today.radios.delete(key);
      });
      return read;
    };
    const inLibrary = libraryFinder(library.songs);
    const mixes: DesktopMix[] = [];
    for (const { row, seeds } of rows) {
      const reads = await Promise.all(
        seeds.map(async (seed) => ({
          seed,
          pages: (
            await Promise.all(
              mixSeedArtists(seed).map(async (artist) => {
                const radio = await radioOf(artist);
                statuses.push(radio.status);
                return radio.songs.length === 0
                  ? []
                  : [{ id: artist.name, artists: [artist.name], songs: radio.songs }];
              }),
            )
          ).flat(),
        })),
      );
      const ranked = rankedDiscoverMixes(
        reads,
        { library, known: { known: deps.known, inLibrary, nonD: [] }, profileOf },
        using,
      );
      for (const mix of ranked)
        mixes.push({
          ...blendDiscoverMix(mix, { level: using.level }),
          name: discoverMixName(mix.seed),
          row,
        });
    }
    const status: YtStatus =
      mixes.length > 0
        ? "ok"
        : (statuses.find((s) => s === "offline") ??
          statuses.find((s) => s === "disabled") ??
          statuses.find((s) => s === "failed") ??
          "ok");
    // A day with no mixes (the connection, or a Library not scanned yet) is tried again on the
    // next call, with new seeds.
    if (mixes.length > 0) {
      for (const { row, seeds } of rows) today.seeds.set(row, seeds);
      built = { date, settings: using, rows: rowIds.join(), mixes };
    }
    return { status, mixes };
  };

  return {
    settings: () => settings,
    setSettings: (value) => {
      settings = value;
      deps.saveSettings?.(value);
    },
    picks: () =>
      randomMagicQueuePicks(
        {
          trackIds: deps.library().trackIds,
          videoIds: deps.enabled?.() === false ? [] : (deps.entryVideoIds?.() ?? []),
        },
        random,
      ),
    mixes: async () => {
      for (;;) {
        if (deps.enabled?.() === false) return { status: "disabled", mixes: [] };
        if (deps.online?.() === false) return { status: "offline", mixes: [] };
        const using = settings;
        const rowIds = shownRows();
        const rows = rowIds.join();
        if (rowIds.length === 0) return { status: "ok", mixes: [] };
        if (built?.date === deps.today() && built.settings === using && built.rows === rows)
          return { status: "ok", mixes: built.mixes };
        if (building === null) {
          const started = { settings: using, rows, read: build(using, rowIds) };
          building = started;
          void started.read.finally(() => {
            if (building === started) building = null;
          });
        }
        const { settings: used, rows: usedRows, read } = building;
        const result = await read;
        // A build under way when the sliders or rows changed is followed by one for them.
        if (used === settings && usedRows === shownRows().join()) return result;
      }
    },
    mix: (id) => built?.mixes.find((mix) => mix.id === id),
    placed: (id) => {
      const mix = built?.mixes.find((found) => found.id === id);
      if (mix === undefined) return undefined;
      const ids = deps.track === undefined ? new Set(deps.library().trackIds) : undefined;
      const has = (trackId: number) => deps.track?.(trackId) ?? ids?.has(trackId) === true;
      return placeDiscoverMixSongs(mix, {
        find: (song) => deps.find?.(song) ?? null,
        track: (trackId) => (has(trackId) ? trackId : null),
      });
    },
  };
};
