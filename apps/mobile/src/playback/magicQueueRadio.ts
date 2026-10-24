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
  libraryFinder,
  magicRadioLookups,
  magicYtSong,
  networkUseBytes,
  type GenreProfileLibrary,
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
import { artistGraphNow } from "@/home/artistGraphNow";
import { harvestMobileUsed, noteHarvestMobileUse } from "@/home/harvestMobileUse";
import { mixCatalog } from "@/home/mixCatalog";
import { artistRadio } from "@/home/ytArtistPage";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
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

type MagicLibrary = GenreProfileLibrary & { readonly songs: readonly SongRow[] };

/** Whether the Library has a YouTube Music song, as [library]'s songs tell. */
const inLibraryOf = (library: MagicLibrary) => {
  const find = libraryFinder(library.songs);
  return (song: Parameters<typeof find>[0]) => find(song) !== null;
};

/**
 * Reads [session]'s radio artists' radios at once, each into the catalog as
 * it comes (as that artist's radio), then looks up the genres of the
 * artists that decide its next 20 candidates (`magicRadioLookups`, a round
 * at a time). Gives how many songs the radios brought.
 */
const readRadios = (
  session: MagicSession,
  library: MagicLibrary,
  profileOf: GenreProfileOf,
  threshold?: number,
) =>
  Effect.gen(function* () {
    const radios = yield* Effect.all(
      session.radioArtists.map((name) =>
        artistRadioSongs(name).pipe(Effect.tap((songs) => noteRadioNow(name, songs))),
      ),
      { concurrency: "unbounded" },
    );
    const radio = radios.flat();
    const inLibrary = inLibraryOf(library);
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
 * use; the catalog and the artist graph are read again after it. Gives the
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
    let used: MagicRefill = { bytes: 0, reached: false };
    yield* withNetworkLog(
      "Magic Queue radio",
      readRadios(session, library, profileOf, threshold).pipe(Effect.timeout(RADIO_TIMEOUT)),
      (songs) => (songs === 0 ? "no radio" : `${songs} songs`),
      (use) => {
        used = { bytes: networkUseBytes(use), reached: use.ytMusic.bytes > 0 };
      },
    ).pipe(Effect.ignore);
    return used;
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
  }: {
    readonly taste: TasteProfile | null;
    readonly engine?: Omit<RecommendOptions, "avoid">;
    readonly profileOf: GenreProfileOf;
    readonly styleOf: StyleOf;
  },
) =>
  Effect.gen(function* () {
    if (!ytMusicEnabled()) return [];
    const graph = yield* artistGraphNow;
    yield* recommendationTurnEffect;
    const pick = yield* magicCatalogRead(session, {
      online: online(),
      onMobileData: onMobileData(),
      usedToday: harvestMobileUsed(),
      now: Date.now(),
      catalog: mixCatalog.pipe(Effect.orElseSucceed(() => [])),
      graph,
      profileOf,
      styleOf,
      taste,
      inLibrary: inLibraryOf(library),
      cached: cachedVideos,
      refill: refill(session, library, profileOf, engine?.threshold),
      usedOnMobile: noteHarvestMobileUse,
      tried: refillsTried,
      ...(engine === undefined ? {} : { engine }),
    });
    found = { candidates: pick.candidates, profileOf };
    return pick.candidates;
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
