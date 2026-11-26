/** Magic Queue reads its seed's radio and ranks it with the last available Wave signals. */
import {
  catalogSeedKey,
  djFirstRadioSong,
  djRadioSongAllowed,
  djNewReleasesRanked,
  djMoodFiltered,
  djMoodFilteredSteps,
  djFirstMoodFit,
  djNewReleasesRankedSteps,
  djFirstSongPick,
  djVarietyMoodPools,
  djVarietyMoodPoolsSteps,
  DJ_FIRST_UNKNOWN_WAIT_MS,
  identityKey,
  libraryFinderSteps,
  type MixKnownSongs,
  magicLibraryMapperSteps,
  magicLibrarySongs,
  magicRadioExclusionsSteps,
  magicRadioReadPlan,
  magicFaithfulGenreProfile,
  magicSeedProfile,
  magicYtSong,
  availableMagicSongsSteps,
  filterSteps,
  mapSteps,
  rankRadioSongsSteps,
  type ArtistGraph,
  type CatalogSong,
  type DjAudioFeatures,
  type DjCandidatePools,
  type DjMoodFit,
  type GenreProfileOf,
  type MagicSession,
  type MagicSong,
  type MixSliders,
  type TasteProfile,
  type YtArtistSaved,
  type YtAlbumSong,
  type RankedRadioSong,
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

/** A radio's songs its session's family allows, and those of them that aren't videos. */
interface AllowedRadio {
  readonly id: string;
  readonly artists: readonly string[];
  readonly songs: readonly YtAlbumSong[];
  readonly audio: readonly YtAlbumSong[];
}

const isAudio = (song: YtAlbumSong): boolean => !("video" in song && song.video === true);

/** The songs of the radios [read] has that [allowed] keeps, a song per step (#1448). */
function* allowedRadioSongs(
  read: readonly SongRadioRead[],
  allowed: (id: string, songArtists: readonly string[]) => boolean,
): Generator<void, AllowedRadio[]> {
  const radios: AllowedRadio[] = [];
  for (const { seed, page } of read) {
    if (page === null) continue;
    const songs: YtAlbumSong[] = [];
    const audio: YtAlbumSong[] = [];
    for (const song of page.songs) {
      yield;
      if (!allowed(seed.id, song.artists)) continue;
      songs.push(song);
      if (isAudio(song)) audio.push(song);
    }
    radios.push({ id: seed.id, artists: seed.artists, songs, audio });
  }
  return radios;
}
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
    const mood = (sessionNow?.() ?? session).dj?.mood ?? [];
    const catalogVideos = catalog.map(({ song }) => song.videoId);
    const moodFeatures =
      mood.length === 0
        ? new Map()
        : yield* store.djMoodFeatures(catalogVideos).pipe(Effect.orElseSucceed(() => new Map()));
    const libraryMoodFeatures =
      mood.length === 0
        ? new Map()
        : yield* store.djLibraryMoodFeatures().pipe(Effect.orElseSucceed(() => new Map()));
    const genreRows =
      mood.length === 0
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
    // Every Library song and artist, so in slices (#1448).
    const playable = yield* runSteps(filterSteps(library.songs, songHasFile), freeTurnEffect);
    const mapLibrary = yield* runSteps(magicLibraryMapperSteps(library.artists), freeTurnEffect);
    // Mapped once, in slices: every original ranking weighs the whole playable Library.
    const playableMagic = yield* runSteps(mapSteps(playable, mapLibrary), freeTurnEffect);
    // The snapshot already indexed recordings. A cold session indexes its playable songs, in slices,
    // so a radio song's step looks up its title instead of matching the whole Library (#1448).
    const find: MixKnownSongs<SongRow>["inLibrary"] =
      library.known?.inLibrary ?? (yield* runSteps(libraryFinderSteps(playable), freeTurnEffect));
    const popularity = new Map(
      yield* runSteps(
        mapSteps(catalog, (entry) => [entry.song.videoId, 1 - 0.5 ** entry.radios.length] as const),
        freeTurnEffect,
      ),
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
    // Its mood then splits the ranking into the songs it matches and those it can't tell, and
    // drops the off ones (`djMoodFiltered`). Both go over the whole ranking, the playable Library
    // included, so they run in slices (#1448).
    const rank = (group: readonly SongRadioSeed[], original: boolean, faithfulFallback = false) =>
      Effect.gen(function* () {
        const ranked = yield* radioRanked(group, original, faithfulFallback);
        const released = yield* runSteps(
          djNewReleasesRankedSteps(sessionNow?.() ?? session, ranked, releases, Date.now()),
          freeTurnEffect,
        );
        return yield* runSteps(
          djMoodFilteredSteps(released, mood, moodFeatures, moodGenres, libraryMoodFeatures),
          freeTurnEffect,
        );
      });
    const radioRanked = (
      group: readonly SongRadioSeed[],
      original: boolean,
      faithfulFallback: boolean,
    ) =>
      Effect.gen(function* () {
        const current = sessionNow?.() ?? session;
        const read = readers.current(session.id, group);
        // Old artist radios still provide an offline fallback until an ordered page is saved.
        const familyAllowed = (id: string, songArtists: readonly string[]): boolean =>
          djRadioSongAllowed(current, id, songArtists, profileOf, graph);
        // A song per step (#1448): radios read again with their continuations hold thousands.
        const radios = yield* runSteps(allowedRadioSongs(read, familyAllowed), freeTurnEffect);
        // Only an offline batch with no radio page reads the catalog: it may hold thousands of songs.
        if (original && radios.length === 0 && !connected) {
          const fallback = yield* runSteps(
            filterSteps(catalog, (entry) =>
              entry.radios.some(
                (radio) =>
                  artists.some((name) => catalogSeedKey(name) === radio.seed) &&
                  familyAllowed(`artist:${radio.seed}`, entry.song.artists),
              ),
            ),
            freeTurnEffect,
          );
          const songs = fallback.map((entry) => entry.song);
          const audio = yield* runSteps(filterSteps(songs, isAudio), freeTurnEffect);
          radios.push({ id: seeds[0]!.id, artists, songs, audio });
        }
        const exclude = yield* runSteps(
          magicRadioExclusionsSteps(
            current,
            radios.flatMap((radio) => radio.songs),
          ),
          freeTurnEffect,
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
            // Several radios interleave by position before ranking; their videos were left out.
            pages: radios.map(({ id, artists, audio }) => ({ id, artists, songs: audio })),
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
        return yield* runSteps(
          (function* () {
            const songs = yield* ranked;
            return yield* availableMagicSongsSteps(current, songs, {
              online: online(),
              ytMusic: ytMusicEnabled(),
              cachedVideos,
            });
          })(),
          freeTurnEffect,
        );
      });
    // A DJ session's Artist variety limits who a batch may hold; any other keeps every song.
    // A mood's unknown songs are kept apart, as the batch's fill once its matched ones run out,
    // and varied in the same pass: High credits no matched song's artist again among them.
    const allowed = (size: number) =>
      Effect.gen(function* () {
        const seed = yield* rank(seeds, true);
        const likedRanked = yield* rank(liked, false);
        const { matched, unknown } = yield* runSteps(
          djVarietyMoodPoolsSteps(
            sessionNow?.() ?? session,
            graph,
            { seed: seed.matched, liked: likedRanked.matched },
            { seed: seed.unknown, liked: likedRanked.unknown },
            size,
            new Map([...seed.fits, ...likedRanked.fits]),
          ),
          freeTurnEffect,
        );
        return { ...matched, unknown };
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
    const { seed: candidates, liked: likedCandidates, unknown } = yield* allowed(plan.size);
    // Ranked again at Close only when the faithful batch comes up short (`completeMagicRadioBatch`).
    // Done now, in slices, so Close never ranks in one block. A DJ session is never faithful: its
    // mood's unknown songs fill a short batch instead.
    const fallback: (() => DjCandidatePools<RankedRadioSong>) | undefined = session.faithful
      ? yield* Effect.map(
          Effect.all([rank(seeds, true, true), rank(liked, false, true)]),
          ([seed, likedRanked]) =>
            () => ({ seed: seed.matched, liked: likedRanked.matched }),
        )
      : unknown.seed.length + unknown.liked.length > 0
        ? () => unknown
        : undefined;
    found = [...candidates, ...likedCandidates, ...unknown.seed, ...unknown.liked];
    const songs = read.reduce((sum, { page }) => sum + (page?.songs.length ?? 0), 0);
    return {
      candidates,
      likedCandidates,
      fallback,
      ranked: songs,
      eligible:
        candidates.length + likedCandidates.length + unknown.seed.length + unknown.liked.length,
      refilled: read.every(({ page }) => page === null) ? null : songs,
    };
  });

/**
 * The batch-ranked order for directly selected, playable DJ Library songs, without radio reads:
 * the songs the session's mood matches, and apart the ones it can't tell (`djMoodFiltered`).
 */
export const magicQueueDjLibraryRanking = (
  session: MagicSession,
  candidates: readonly SongRow[],
  library: { readonly songs: readonly SongRow[]; readonly artists: readonly ArtistRow[] },
  {
    catalog,
    graph,
    taste,
    profileOf,
    sliders,
  }: {
    readonly catalog: readonly CatalogSong[];
    readonly graph: ArtistGraph | null;
    readonly taste: TasteProfile | null;
    readonly profileOf: GenreProfileOf;
    readonly sliders: MixSliders;
  },
) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const mood = session.dj?.mood ?? [];
    const catalogVideos = catalog.map(({ song }) => song.videoId);
    const moodFeatures =
      mood.length === 0
        ? new Map()
        : yield* store.djMoodFeatures(catalogVideos).pipe(Effect.orElseSucceed(() => new Map()));
    const libraryMoodFeatures =
      mood.length === 0
        ? new Map()
        : yield* store.djLibraryMoodFeatures().pipe(Effect.orElseSucceed(() => new Map()));
    const genreRows =
      mood.length === 0
        ? []
        : yield* store.songGenres(catalogVideos).pipe(Effect.orElseSucceed(() => []));
    const moodGenres = new Map(genreRows.map(({ id, genre }) => [String(id), genre] as const));
    savedPage = (name) => Effect.runPromise(store.ytArtist(identityKey(name)));
    const releases = yield* Effect.promise(() => releasePages(session, graph));
    yield* Effect.promise(loadDislikes);
    const mapLibrary = magicLibrarySongs(library.artists);
    const playable = candidates.filter(songHasFile);
    const playableMagic = yield* runSteps(mapSteps(playable, mapLibrary), freeTurnEffect);
    const ranked = yield* runSteps(
      rankRadioSongsSteps(
        {
          artists: session.radioArtists,
          profile: session.faithful
            ? magicFaithfulGenreProfile(session, profileOf)
            : magicSeedProfile(session, profileOf),
        },
        {
          pages: [],
          graph,
          taste,
          profileOf,
          library: playableMagic,
          signals: session.radioSignals ?? [],
          disliked: dislikedSongsNow(),
        },
        {
          ...sliders,
          faithfulness: session.faithful ? 1 : sliders.faithfulness,
          popularity: session.faithful ? 3 : sliders.popularity,
          excludeIncompatible: session.faithful,
          libraryFallback: true,
        },
      ),
      freeTurnEffect,
    );
    const { matched, unknown, fits } = djMoodFiltered(
      djNewReleasesRanked(session, ranked, releases, Date.now()),
      mood,
      moodFeatures,
      moodGenres,
      libraryMoodFeatures,
    );
    // Varied in one pass, so High credits no matched song's artist again among the unknown ones.
    const varied = djVarietyMoodPools(
      session,
      graph,
      { seed: matched, liked: [] },
      { seed: unknown, liked: [] },
      matched.length + unknown.length,
      fits,
    );
    return { matched: varied.matched.seed, unknown: varied.unknown.seed };
  });

/**
 * The first song a DJ session's first batch could take (`djFirstRadioSong`:
 * dislikes, used and learned songs, family radios, Artist variety) from any
 * selected radio, while its peers keep loading. With a mood, it's a song the
 * cached features say matches it; with none yet, a song the mood can't tell
 * starts once `DJ_FIRST_UNKNOWN_WAIT_MS` has passed or a radio has answered
 * from the network (`djFirstSongPick`), and an off song never does.
 */
export const magicQueueFirstRadioSong = (
  session: MagicSession,
  seeds: readonly SongRadioSeed[],
  deadlineAt: number,
  {
    graph,
    profileOf,
    onSettled,
  }: {
    readonly graph: ArtistGraph | null;
    readonly profileOf: GenreProfileOf;
    readonly onSettled: () => void;
  },
) =>
  Effect.gen(function* () {
    const yt = yield* YtMusic;
    const context = yield* Effect.context<LibraryStore>();
    const store = yield* LibraryStore;
    const readers = radioReaders(yt, context);
    yield* Effect.promise(loadDislikes);
    const first = yield* Deferred.make<YtAlbumSong | null>();
    const mood = session.dj?.mood ?? [];
    const startedAt = Date.now();
    let chosen = false;
    /** The first pick the mood couldn't tell, started if no match comes in time. */
    let unknownFirst: YtAlbumSong | null = null;
    /** Whether a radio's read has answered, and whether every one has. */
    let answered = false;
    let settled = false;
    /** Starts [matched], or the unknown pick once `djFirstSongPick` says it's time. */
    const decide = (matched: YtAlbumSong | null, waitedMs = Date.now() - startedAt) =>
      Effect.suspend(() => {
        if (chosen) return Effect.void;
        const song = djFirstSongPick({
          matched,
          unknown: unknownFirst,
          waitedMs,
          answered,
          settled,
        });
        if (song === undefined) return Effect.void;
        chosen = true;
        return Deferred.succeed(first, song).pipe(Effect.asVoid);
      });
    // A radio with a cached page is told of it before its read answers.
    const cachedFirst = new Set(
      readers
        .current(session.id, seeds)
        .filter(({ page }) => page !== null)
        .map(({ seed }) => seed.id),
    );
    const onPage = ({ seed, page }: SongRadioRead): Effect.Effect<void> =>
      Effect.gen(function* () {
        const fromRead = !cachedFirst.delete(seed.id);
        if (chosen) return;
        if (page === null) {
          answered ||= fromRead;
          return yield* decide(null);
        }
        const videoIds = page.songs.map((song) => song.videoId);
        const known =
          mood.length === 0
            ? new Map<string, DjAudioFeatures>()
            : yield* store
                .djMoodFeatures(videoIds)
                .pipe(Effect.orElseSucceed(() => new Map<string, DjAudioFeatures>()));
        const genreRows =
          mood.length === 0
            ? []
            : yield* store.songGenres(videoIds).pipe(Effect.orElseSucceed(() => []));
        const genres = new Map(genreRows.map(({ id, genre }) => [String(id), genre] as const));
        if (chosen) return;
        const moodFit = (song: YtAlbumSong): DjMoodFit =>
          mood.length === 0
            ? "matched"
            : djFirstMoodFit(
                mood,
                known.get(song.videoId) ?? null,
                genres.get(song.videoId) ?? null,
              );
        const song = djFirstRadioSong(session, seed.id, page.songs, {
          graph,
          profileOf,
          disliked: dislikedSongsNow(),
          moodFit,
        });
        answered ||= fromRead;
        if (song !== null && moodFit(song) === "matched") return yield* decide(song);
        if (song !== null) unknownFirst ??= song;
        yield* decide(null);
      });
    if (mood.length > 0)
      yield* Effect.forkDetach(
        Effect.sleep(DJ_FIRST_UNKNOWN_WAIT_MS).pipe(
          Effect.andThen(decide(null, DJ_FIRST_UNKNOWN_WAIT_MS)),
        ),
      );
    yield* Effect.forkDetach(
      readers
        .read(session.id, seeds, {
          online: ytMusicEnabled() && online(),
          low: false,
          deadlineAt,
          onPage,
        })
        .pipe(
          Effect.tap(() =>
            Effect.suspend(() => {
              settled = true;
              return decide(null);
            }),
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
