/**
 * A Magic Queue's YouTube Music candidates (docs/spec.md, Magic Queue): out
 * of the candidate catalog, ranked by the engine for the session's radio
 * artists and the seed songs' genres, the session's signals and the owner's
 * taste on top (`magicCatalogRead`), with no request while the session has
 * enough. When it runs low, the radios of its radio artists are read as
 * before, into the catalog, under the harvest's network policy (on mobile
 * data only when none is left, counted in the harvest's ~5 MB a day), and
 * the genres of the artists that decide the next candidates looked up on
 * Deezer (`magicRadioLookups`). Offline, only the songs the audio cache
 * holds whole; none with the YT Music switch off.
 */
import {
  libraryFinderSteps,
  magicRadioLookups,
  magicYtSong,
  networkUseBytes,
  type GenreProfileLibrary,
  type ArtistGraph,
  type CatalogSong,
  type CatalogPage,
  type GenreProfile,
  type GenreProfileOf,
  type MagicCatalogCandidate,
  type MagicSession,
  type MagicSong,
  type RecommendOptions,
  type StyleOf,
  type TasteProfile,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { lookUpArtistProfiles, lookedUpProfileOf } from "@/home/artistGenres";
import { harvestMobileUsed, noteHarvestMobileUse } from "@/home/harvestMobileUse";
import { artistRadio } from "@/home/ytArtistPage";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { runSteps } from "@/lib/stepped";
import { withNetworkLog } from "@/lib/networkMeter";
import type { SongRow } from "@/library/LibraryStore";
import { onMobileData, online } from "@/native/waveNative";
import { WaveYtMusic, type NativeYtRadioSong } from "@/native/waveYtMusic";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { noteRadioNow } from "@/ytmusic/candidateCatalog";
import { YtMusic } from "@/ytmusic/YtMusic";

import { magicCatalogRead, type MagicRefill } from "./magicCatalogRead";

/** A refill's radio reads take this long at most; past it, the batch has what the catalog has. */
const RADIO_TIMEOUT = "15 seconds";

/**
 * The first page of [name]'s artist radio, and the next one when there is
 * one; none when YouTube Music doesn't have the artist or can't be reached.
 */
const artistRadioSongs = (name: string) =>
  Effect.gen(function* () {
    const first = yield* artistRadio({ name });
    if (first === null) return [];
    const ytMusic = yield* YtMusic;
    const next =
      first.continuation === null
        ? null
        : yield* ytMusic.radioMore(first.continuation).pipe(Effect.orElseSucceed(() => null));
    return next === null ? first.songs : [...first.songs, ...next.songs];
  }).pipe(Effect.orElseSucceed((): readonly NativeYtRadioSong[] => []));

/**
 * The first two pages of the seed song's own radio (its first video id's),
 * for a seed whose artists' radios brought nothing; none without a video id
 * or when YouTube Music can't be reached.
 */
const seedSongRadio = (session: MagicSession) =>
  Effect.gen(function* () {
    const videoId = session.seedVideoIds[0];
    if (videoId === undefined) return [];
    const ytMusic = yield* YtMusic;
    const first = yield* ytMusic.radio({ videoId });
    const next =
      first.continuation === null
        ? null
        : yield* ytMusic.radioMore(first.continuation).pipe(Effect.orElseSucceed(() => null));
    return next === null ? first.songs : [...first.songs, ...next.songs];
  }).pipe(Effect.orElseSucceed((): readonly NativeYtRadioSong[] => []));

type MagicLibrary = GenreProfileLibrary & { readonly songs: readonly SongRow[] };

/** Whether the Library has a YouTube Music song, as [library]'s songs tell. */
const inLibraryOf = (library: MagicLibrary) =>
  Effect.gen(function* () {
    const find = yield* runSteps(libraryFinderSteps(library.songs), recommendationTurnEffect);
    return (song: Parameters<typeof find>[0]) => find(song) !== null;
  });

/**
 * Reads [session]'s radio artists' radios at once, each into the catalog as
 * it comes (as that artist's radio); when they bring nothing (YouTube Music
 * doesn't know the artist by name), the seed song's own radio, written as
 * its first radio artist's (`seedSongRadio`). Then looks up the genres of
 * the artists that decide its next 20 candidates, or of the radio's artists
 * while the seed's genre is unknown (`magicRadioLookups`, a round at a
 * time). Gives how many songs the radios brought.
 */
const readRadios = (
  session: MagicSession,
  library: MagicLibrary,
  profileOf: GenreProfileOf,
  pages: CatalogPage[],
  threshold?: number,
) =>
  Effect.gen(function* () {
    const radios = yield* Effect.all(
      session.radioArtists.map((name) =>
        artistRadioSongs(name).pipe(
          Effect.tap((songs) =>
            Effect.sync(() => {
              pages.push({ seed: name, songs });
            }),
          ),
          Effect.tap((songs) => noteRadioNow(name, songs)),
        ),
      ),
      { concurrency: "unbounded" },
    );
    let radio: readonly NativeYtRadioSong[] = radios.flat();
    const standIn = session.radioArtists[0];
    if (radio.length === 0 && standIn !== undefined) {
      radio = yield* seedSongRadio(session);
      if (radio.length > 0) {
        pages.push({ seed: standIn, songs: radio });
        yield* noteRadioNow(standIn, radio);
      }
    }
    const inLibrary = yield* inLibraryOf(library);
    const asked: string[] = [];
    for (
      let names = magicRadioLookups(session, radio, { profileOf, inLibrary, asked, threshold });
      names.length > 0;
      names = magicRadioLookups(session, radio, { profileOf, inLibrary, asked, threshold })
    ) {
      asked.push(...names);
      yield* lookUpArtistProfiles(names);
    }
    return radio.length;
  });

/**
 * [session]'s refill: its radios read into the catalog (`readRadios`), 15 s
 * at most, written to the app log as "Magic Queue radio" with its network
 * use. The received pages extend this batch's catalog without another snapshot read. Gives the
 * bytes it used, and whether YouTube Music answered (any of its bytes came,
 * even for an artist it doesn't have). Never fails.
 */
const refill = (
  session: MagicSession,
  library: MagicLibrary,
  profileOf: GenreProfileOf,
  threshold?: number,
) =>
  Effect.gen(function* () {
    const pages: CatalogPage[] = [];
    let used = { bytes: 0, reached: false };
    yield* withNetworkLog(
      "Magic Queue radio",
      readRadios(session, library, profileOf, pages, threshold).pipe(Effect.timeout(RADIO_TIMEOUT)),
      (songs) => (songs === 0 ? "no radio" : `${songs} songs`),
      (use) => {
        used = { bytes: networkUseBytes(use), reached: use.ytMusic.bytes > 0 };
      },
    ).pipe(Effect.ignore);
    return { ...used, pages } satisfies MagicRefill;
  });

/** The video ids the audio cache holds whole; none when it can't tell. */
const cachedVideos = Effect.tryPromise(() => WaveYtMusic.cachedVideos()).pipe(
  Effect.map((ids): ReadonlySet<string> => new Set(ids)),
  Effect.orElseSucceed((): ReadonlySet<string> => new Set()),
);

/** When each Magic Queue's refill was last tried this launch, by session id (`magicCatalogRead`). */
const refillsTried = new Map<string, number>();

/** The session's latest candidates, and the genre profiles they were weighed by. */
let found: {
  readonly candidates: readonly MagicCatalogCandidate[];
  readonly profileOf: GenreProfileOf;
} | null = null;

/** A batch's YouTube Music candidates, with the counts the app log explains an empty batch by. */
export interface MagicYtPick {
  readonly candidates: readonly MagicCatalogCandidate[];
  /** The catalog songs the engine ranked, and those eligible for the batch. */
  readonly ranked: number;
  readonly eligible: number;
  /** The songs a refill's radios brought; null when none ran. */
  readonly refilled: number | null;
  /** The seed's profile the candidates were held to (`magicSeedProfile`); absent with YT Music off. */
  readonly profile?: GenreProfile | null;
}

const NO_YT: MagicYtPick = { candidates: [], ranked: 0, eligible: 0, refilled: null };

/**
 * [session]'s YouTube Music candidates for its next batch, weighed against
 * [library] (its songs and artists), the genre profiles [profileOf] gives
 * (the Library's, else Deezer's: `magicProfileOf`) and the owner's
 * [taste]: out of the candidate catalog (`magicCatalogRead`), the radios
 * read first only when
 * the session runs low and the network policy allows it. The engine ranks
 * with [engine]'s weights (the Magic Queue section's sliders; absent: its
 * defaults). None with the YT Music switch off. A graph read failure reaches the batch's retry line.
 */
export const magicQueueYtCandidates = (
  session: MagicSession,
  library: MagicLibrary,
  {
    taste,
    engine,
    profileOf,
    styleOf,
    catalog,
    graph,
  }: {
    readonly catalog: readonly CatalogSong[];
    readonly graph: ArtistGraph;
    readonly taste: TasteProfile | null;
    readonly engine?: Omit<RecommendOptions, "avoid">;
    readonly profileOf: GenreProfileOf;
    readonly styleOf: StyleOf;
  },
) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return NO_YT;
    const inLibrary = yield* inLibraryOf(library);
    const pick = yield* magicCatalogRead(session, {
      online: online(),
      onMobileData: onMobileData(),
      usedToday: harvestMobileUsed(),
      now: Date.now(),
      catalog,
      between: recommendationTurnEffect,
      graph,
      profileOf,
      styleOf,
      taste,
      inLibrary,
      cached: cachedVideos,
      refill: refill(session, library, profileOf, engine?.threshold),
      usedOnMobile: noteHarvestMobileUse,
      tried: refillsTried,
      ...(engine === undefined ? {} : { engine }),
    });
    found = { candidates: pick.candidates, profileOf };
    return {
      candidates: pick.candidates,
      ranked: pick.ranked,
      eligible: pick.left,
      refilled: pick.refilled,
      profile: pick.profile,
    } satisfies MagicYtPick;
  });

/**
 * A YT Music song of the queue as the Magic Queue weighs it (`magicYtSong`):
 * by its artists, and its genre as the session's latest candidates weighed
 * it (an outside artist's as Deezer gave it, when it isn't among them).
 */
export const magicStreamedSong = (track: {
  readonly id: string;
  readonly artists: readonly string[];
}): MagicSong =>
  found?.candidates.find((candidate) => candidate.trackId === track.id) ??
  magicYtSong({ trackId: track.id, artists: track.artists }, found?.profileOf ?? lookedUpProfileOf);
