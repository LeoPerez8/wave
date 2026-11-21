/** Magic Queue reads its seed's radio and ranks it with the last available Wave signals. */
import {
  catalogSeedKey,
  djRadioSongAllowed,
  djNewReleasesRanked,
  djMoodRanked,
  djVarietyCandidates,
  identityKey,
  recordingMatches,
  type MixKnownSongs,
  magicLibrarySongs,
  magicRadioExclusions,
  magicRadioReadPlan,
  magicFaithfulGenreProfile,
  magicSeedProfile,
  magicYtSong,
  availableMagicSongs,
  mapSteps,
  rankRadioSongsSteps,
  type ArtistGraph,
  type CatalogSong,
  type GenreProfileOf,
  type MagicSession,
  type MagicSong,
  type MixSliders,
  type TasteProfile,
  type YtArtistSaved,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";

import { lookedUpProfileOf } from "@/home/artistGenres";
import { freeTurnEffect } from "@/lib/backgroundWork";
import { runSteps } from "@/lib/stepped";
import { djReleasePagesReader } from "@/dj/djReleases";
import { dislikedSongsNow, loadDislikes } from "@/library/dislikes";
import { LibraryStore } from "@/library/LibraryStore";
import { songHasFile, type SongRow, type ArtistRow } from "@wave/client";
import { online } from "@/native/waveNative";
import { WaveYtMusic } from "@/native/waveYtMusic";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { YtMusic } from "@/ytmusic/YtMusic";
import type { SongRadioSeed } from "./songRadioSession";
import type { SongRadioRead } from "./songRadioReaders";
import { createAppSongRadioReaders } from "./songRadioSetup";

let found: readonly MagicSong[] = [];
const radioReaders = createAppSongRadioReaders("Magic Queue");

/** What's saved for an artist's page, read from the Library's store once a batch has it. */
let savedPage: (name: string) => Promise<YtArtistSaved | null> = () => Promise.resolve(null);
/** The saved pages of a DJ session's artists, for its New releases filter. */
const releasePages = djReleasePagesReader((name) => savedPage(name));

/**
 * The radio an old session reads when it saved none (`magicBatchRadios`
 * gives no seed): its artists', from its first seed video when it has one.
 */
const legacySeed = (session: MagicSession): SongRadioSeed => ({
  id: session.seed.kind === "artist" ? `artist:${session.seed.id}` : `song:${session.seed.id}`,
  title: session.seed.title,
  artists: session.radioArtists,
  durationMs: null,
  ...(session.seedVideoIds[0] === undefined ? {} : { videoId: session.seedVideoIds[0] }),
  ...(session.seed.kind === "artist" ? { kind: "artist" as const } : {}),
});

/**
 * Reads only when online, every radio of the batch ([drawn], `magicBatchRadios`)
 * at once. A cached first page answers at once while its live refresh runs
 * in the background.
 */
export const magicQueueYtCandidates = (
  session: MagicSession,
  drawn: readonly SongRadioSeed[],
  library: {
    readonly songs: readonly SongRow[];
    readonly artists: readonly ArtistRow[];
    readonly known?: Pick<MixKnownSongs<SongRow>, "inLibrary">;
  },
  {
    catalog,
    graph,
    taste,
    profileOf,
    sliders,
    sessionNow,
    deadlineAt,
  }: {
    readonly catalog: readonly CatalogSong[];
    readonly graph: ArtistGraph | null;
    readonly taste: TasteProfile | null;
    readonly profileOf: GenreProfileOf;
    readonly sliders: MixSliders;
    readonly sessionNow?: () => MagicSession;
    /** When the radio reads stop (epoch ms), if they share a deadline with what came before them. */
    readonly deadlineAt?: number;
  },
) =>
  Effect.gen(function* () {
    const yt = yield* YtMusic;
    if (!ytMusicEnabled() && !session.continuation)
      return {
        candidates: [],
        likedCandidates: [],
        fallback: undefined,
        ranked: 0,
        eligible: 0,
        refilled: null,
      };
    const context = yield* Effect.context<LibraryStore>();
    // A DJ session's New releases ranks with its artists' saved pages; none is asked for.
    const store = yield* LibraryStore;
    savedPage = (name) => Effect.runPromise(store.ytArtist(identityKey(name)));
    const mood = (sessionNow?.() ?? session).dj?.mood ?? null;
    const catalogVideos = catalog.map(({ song }) => song.videoId);
    const moodFeatures =
      mood === null
        ? new Map()
        : yield* store.djMoodFeatures(catalogVideos).pipe(Effect.orElseSucceed(() => new Map()));
    const libraryMoodFeatures =
      mood === null
        ? new Map()
        : yield* store.djLibraryMoodFeatures().pipe(Effect.orElseSucceed(() => new Map()));
    const genreRows =
      mood === null
        ? []
        : yield* store.songGenres(catalogVideos).pipe(Effect.orElseSucceed(() => []));
    const moodGenres = new Map(genreRows.map(({ id, genre }) => [String(id), genre] as const));
    const releases = yield* Effect.promise(() => releasePages(sessionNow?.() ?? session, graph));
    const seeds = drawn.length > 0 ? drawn : [legacySeed(session)];
    const liked = ((sessionNow?.() ?? session).likedRadios ?? []).filter(
      (radio) =>
        !seeds.some(
          (seed) =>
            seed.id === radio.id ||
            (seed.kind !== "artist" &&
              seed.videoId !== undefined &&
              seed.videoId === radio.videoId),
        ),
    );
    const artists = [...new Set(seeds.flatMap((seed) => seed.artists))];
    const readers = radioReaders(yt, context);
    const playable = library.songs.filter(songHasFile);
    const mapLibrary = magicLibrarySongs(library.artists);
    // Mapped once, in slices: every original ranking weighs the whole playable Library.
    const playableMagic = yield* runSteps(mapSteps(playable, mapLibrary), freeTurnEffect);
    // The snapshot already indexed recordings. A cold session has only its seed songs.
    const find: MixKnownSongs<SongRow>["inLibrary"] =
      library.known?.inLibrary ??
      ((song) => playable.find((local) => recordingMatches(local, song)) ?? null);
    const popularity = new Map(
      catalog.map((entry) => [entry.song.videoId, 1 - 0.5 ** entry.radios.length]),
    );
    const connected = ytMusicEnabled() && online();
    const cachedVideos =
      connected || session.continuation
        ? null
        : yield* Effect.tryPromise(() => WaveYtMusic.cachedVideos()).pipe(
            Effect.map((ids) => new Set(ids)),
            Effect.orElseSucceed(() => new Set<string>()),
          );
    // Read before the first ranking; each ranking takes the dislikes as they are by then.
    yield* Effect.promise(loadDislikes);
    // A DJ session's New releases raises the songs on its artists' recent releases; any other keeps the order.
    const rank = (group: readonly SongRadioSeed[], original: boolean, faithfulFallback = false) =>
      Effect.map(radioRanked(group, original, faithfulFallback), (ranked) =>
        djMoodRanked(
          djNewReleasesRanked(sessionNow?.() ?? session, ranked, releases, Date.now()),
          mood,
          moodFeatures,
          moodGenres,
          libraryMoodFeatures,
        ),
      );
    const radioRanked = (
      group: readonly SongRadioSeed[],
      original: boolean,
      faithfulFallback: boolean,
    ) => {
      const current = sessionNow?.() ?? session;
      const read = readers.current(session.id, group);
      // Old artist radios still provide an offline fallback until an ordered page is saved.
      const familyAllowed = (id: string, songArtists: readonly string[]): boolean =>
        djRadioSongAllowed(current, id, songArtists, profileOf, graph);
      const fallback = catalog.flatMap((entry) => {
        const matching = entry.radios.filter((radio) =>
          artists.some((name) => catalogSeedKey(name) === radio.seed),
        );
        return matching.some((radio) => familyAllowed(`artist:${radio.seed}`, entry.song.artists))
          ? [entry.song]
          : [];
      });
      const radios = read.flatMap(({ seed, page }) => {
        if (page === null) return [];
        return [
          {
            id: seed.id,
            artists: seed.artists,
            songs: page.songs.filter((song) => familyAllowed(seed.id, song.artists)),
          },
        ];
      });
      if (original && radios.length === 0 && !connected)
        radios.push({ id: seeds[0]!.id, artists, songs: fallback });
      const exclude = magicRadioExclusions(
        current,
        radios.flatMap((radio) => radio.songs),
      );
      // Ranked in background slices (#1350): a batch never holds the JS thread past 8 ms at a time.
      const ranked = rankRadioSongsSteps(
        {
          artists,
          profile: session.faithful
            ? magicFaithfulGenreProfile(session, profileOf)
            : magicSeedProfile(session, profileOf),
        },
        {
          // Several radios interleave by position before ranking.
          pages: radios.map((radio) => ({
            ...radio,
            songs: radio.songs.filter((song) => !("video" in song && song.video === true)),
          })),
          graph,
          taste,
          profileOf,
          library: original ? playableMagic : [],
          inLibrary: (song) => {
            const local = find(song);
            return local === null || !songHasFile(local) ? null : mapLibrary(local);
          },
          signals: current.radioSignals ?? [],
          popularityOf: (id) => popularity.get(id) ?? 0,
          // A disliked song never enters a batch, from the radios or the Library.
          disliked: dislikedSongsNow(),
        },
        {
          ...sliders,
          faithfulness: current.faithful ? (faithfulFallback ? 2 : 1) : sliders.faithfulness,
          popularity: current.faithful ? 3 : sliders.popularity,
          excludeIncompatible: current.faithful && !faithfulFallback,
          exclude,
          libraryFallback: session.continuation === true && !connected,
        },
      );
      return Effect.map(runSteps(ranked, freeTurnEffect), (songs) =>
        availableMagicSongs(current, songs, {
          online: online(),
          ytMusic: ytMusicEnabled(),
          cachedVideos,
        }),
      );
    };
    // A DJ session's Artist variety limits who a batch may hold; any other keeps every song.
    const allowed = (size: number) =>
      Effect.gen(function* () {
        const seed = yield* rank(seeds, true);
        const likedRanked = yield* rank(liked, false);
        yield* freeTurnEffect;
        return djVarietyCandidates(
          sessionNow?.() ?? session,
          graph,
          { seed, liked: likedRanked },
          size,
        );
      });
    // Unfilled, so a radio short of allowed songs reads its continuations.
    const before = yield* allowed(0);
    const plan = magicRadioReadPlan(
      sessionNow?.() ?? session,
      before.seed,
      before.liked,
      liked.length > 0,
    );
    const originalIds = new Set(seeds.map((seed) => seed.id));
    const read = yield* readers.read(session.id, [...seeds, ...liked], {
      online: connected,
      ...(deadlineAt === undefined ? {} : { deadlineAt }),
      low: (seed) => (originalIds.has(seed.id) ? plan.seedLow : plan.likedLow),
    });
    // The radios' answers are handled in slices too: the network wait itself isn't one.
    const { seed: candidates, liked: likedCandidates } = yield* allowed(plan.size);
    // Ranked again at Close only when the faithful batch comes up short (`completeMagicRadioBatch`).
    // Done now, in slices, so Close never ranks in one block.
    const fallback = session.faithful
      ? yield* Effect.map(
          Effect.all([rank(seeds, true, true), rank(liked, false, true)]),
          ([seed, likedRanked]) =>
            () => ({ seed, liked: likedRanked }),
        )
      : undefined;
    found = [...candidates, ...likedCandidates];
    const songs = read.reduce((sum, { page }) => sum + (page?.songs.length ?? 0), 0);
    return {
      candidates,
      likedCandidates,
      fallback,
      ranked: songs,
      eligible: candidates.length + likedCandidates.length,
      refilled: read.every(({ page }) => page === null) ? null : songs,
    };
  });

/** The first non-placeholder song from any selected radio, while its peers keep loading. */
export const magicQueueFirstRadioSong = (
  sessionId: string,
  seeds: readonly SongRadioSeed[],
  deadlineAt: number,
  onSettled: () => void,
) =>
  Effect.gen(function* () {
    const yt = yield* YtMusic;
    const context = yield* Effect.context<LibraryStore>();
    const readers = radioReaders(yt, context);
    const first = yield* Deferred.make<YtAlbumSong | null>();
    let chosen = false;
    const onPage = ({ page }: SongRadioRead) => {
      const song = page?.songs.find((candidate) => candidate.video !== true) ?? null;
      if (song === null || chosen) return Effect.void;
      chosen = true;
      return Deferred.succeed(first, song).pipe(Effect.asVoid);
    };
    yield* Effect.forkDetach(
      readers
        .read(sessionId, seeds, {
          online: ytMusicEnabled() && online(),
          low: false,
          deadlineAt,
          onPage,
        })
        .pipe(
          Effect.tap(() =>
            chosen ? Effect.void : Deferred.succeed(first, null).pipe(Effect.asVoid),
          ),
          Effect.ensuring(Effect.sync(onSettled)),
        ),
    );
    return yield* Deferred.await(first);
  });

/** Signals use already known genres; this path never looks an artist up. */
export const magicStreamedSong = (track: {
  readonly id: string;
  readonly artists: readonly string[];
}): MagicSong =>
  found.find((candidate) => candidate.trackId === track.id) ??
  magicYtSong({ trackId: track.id, artists: track.artists }, lookedUpProfileOf);
