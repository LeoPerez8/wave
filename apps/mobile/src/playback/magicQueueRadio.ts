/** Magic Queue reads its seed's radio and ranks it with the last available Wave signals. */
import {
  catalogSeedKey,
  recordingMatches,
  type MixKnownSongs,
  magicLibrarySongs,
  magicRadioExclusions,
  magicSeedProfile,
  magicYtSong,
  rankRadioSongs,
  type ArtistGraph,
  type CatalogSong,
  type GenreProfileOf,
  type MagicSession,
  type MagicSong,
  type MixSliders,
  type RankedRadioSong,
  type TasteProfile,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { Storage } from "expo-sqlite/kv-store";

import { artistRadio } from "@/home/ytArtistPage";
import { lookedUpProfileOf } from "@/home/artistGenres";
import { withNetworkLog } from "@/lib/networkMeter";
import { appLog } from "@/log/appLog";
import {
  songHasFile,
  type SongRow,
  type ArtistRow,
  type LibraryStore,
} from "@/library/LibraryStore";
import { online } from "@/native/waveNative";
import { WaveYtMusic } from "@/native/waveYtMusic";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { noteRadioNow } from "@/ytmusic/candidateCatalog";
import { createRadioPageCatalog } from "@/ytmusic/radioPageCatalog";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";
import { createSongRadioReaders } from "./songRadioReaders";
import { createSongRadioSession, type SongRadioSeed } from "./songRadioSession";

const pages = createRadioPageCatalog({
  read: () => Storage.getItemSync("candidateCatalog.radioPages"),
  write: (value) => Storage.setItemSync("candidateCatalog.radioPages", value),
});
let found: readonly MagicSong[] = [];
let services: {
  readonly yt: YtMusic["Service"];
  readonly context: Context.Context<LibraryStore>;
} | null = null;

/**
 * Every Magic Queue radio read so far, by session and radio
 * (`createSongRadioReaders`): the batches' drawn seed songs, an artist's or a
 * song's own radio. Each saves its pages and notes its seed artists' radio
 * in the candidate catalog.
 */
const allReaders = createSongRadioReaders((seed: SongRadioSeed) => {
  const { yt, context } = services!;
  return createSongRadioSession(seed, {
    cached: pages.get(seed.id),
    radio: (videoId) => yt.radio({ videoId }),
    search: (query) =>
      withSearchTurn("discover", query, yt.searchSongs(query)).pipe(
        Effect.map((page) => page.songs),
      ),
    artist: (name) =>
      artistRadio({ name }).pipe(Effect.provide(context), Effect.provideService(YtMusic, yt)),
    more: (token) => yt.radioMore(token),
    measure: (read) =>
      withNetworkLog("Magic Queue radio", read, (page) =>
        page === null ? "no radio" : `${page.songs.length} songs`,
      ),
    save: (page) =>
      Effect.gen(function* () {
        pages.put(seed.id, page);
        const artists =
          seed.artists.length > 0
            ? seed.artists
            : (page.songs.find((song) => song.videoId === seed.videoId)?.artists ?? []);
        for (const artist of artists)
          yield* noteRadioNow(artist, page.songs).pipe(Effect.provide(context));
      }),
    fallback: (name) =>
      appLog(
        "info",
        "WaveRecommendations",
        `Magic Queue: no song match for ${seed.title}; using ${name}'s artist radio`,
      ),
  });
});

/** The readers, making new ones with [yt] and [context]. */
const radioReaders = (yt: YtMusic["Service"], context: Context.Context<LibraryStore>) => {
  services = { yt, context };
  return allReaders;
};

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
  }: {
    readonly catalog: readonly CatalogSong[];
    readonly graph: ArtistGraph | null;
    readonly taste: TasteProfile | null;
    readonly profileOf: GenreProfileOf;
    readonly sliders: MixSliders;
    readonly sessionNow?: () => MagicSession;
  },
) =>
  Effect.gen(function* () {
    const yt = yield* YtMusic;
    if (!ytMusicEnabled())
      return { candidates: [], likedCandidates: [], ranked: 0, eligible: 0, refilled: null };
    const context = yield* Effect.context<LibraryStore>();
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
    // The snapshot already indexed recordings. A cold session has only its seed songs.
    const find: MixKnownSongs<SongRow>["inLibrary"] =
      library.known?.inLibrary ??
      ((song) => playable.find((local) => recordingMatches(local, song)) ?? null);
    const popularity = new Map(
      catalog.map((entry) => [entry.song.videoId, 1 - 0.5 ** entry.radios.length]),
    );
    const connected = online();
    const cachedVideos = connected
      ? null
      : yield* Effect.tryPromise(() => WaveYtMusic.cachedVideos()).pipe(
          Effect.map((ids) => new Set(ids)),
          Effect.orElseSucceed(() => new Set<string>()),
        );
    const rank = (group: readonly SongRadioSeed[], original: boolean) => {
      const current = sessionNow?.() ?? session;
      const read = readers.current(session.id, group);
      // Old artist radios still provide an offline fallback until an ordered page is saved.
      const fallback = catalog
        .filter((entry) =>
          entry.radios.some((r) => artists.some((name) => catalogSeedKey(name) === r.seed)),
        )
        .map((entry) => entry.song);
      const radios = read.flatMap(({ seed, page }) =>
        page === null ? [] : [{ id: seed.id, artists: seed.artists, songs: page.songs }],
      );
      if (original && radios.length === 0 && !connected)
        radios.push({ id: seeds[0]!.id, artists, songs: fallback });
      const exclude = magicRadioExclusions(
        current,
        radios.flatMap((radio) => radio.songs),
      );
      return rankRadioSongs(
        { artists, profile: magicSeedProfile(session, profileOf) },
        {
          // Several radios interleave by position before ranking.
          pages: radios.map((radio) => ({
            ...radio,
            songs: radio.songs.filter((song) => !("video" in song && song.video === true)),
          })),
          graph,
          taste,
          profileOf,
          library: original ? playable.map(mapLibrary) : [],
          inLibrary: (song) => {
            const local = find(song);
            return local === null || !songHasFile(local) ? null : mapLibrary(local);
          },
          signals: current.radioSignals ?? [],
          popularityOf: (id) => popularity.get(id) ?? 0,
        },
        { ...sliders, exclude },
      ).filter(
        (song) =>
          song.source === "library" ||
          cachedVideos === null ||
          (song.song !== null && cachedVideos.has(song.song.videoId)),
      );
    };
    const size = session.batches === 0 ? 9 : 10;
    const learnedShare = liked.length === 0 ? 0 : Math.round(size / 3);
    const low = (ranked: readonly RankedRadioSong[], target: number) =>
      ranked.length < target ||
      ranked.filter((song) => song.source === "stream").length <
        Math.round(target * session.ytShare);
    const originalBefore = rank(seeds, true);
    const likedBefore = rank(liked, false);
    const read = (yield* Effect.all(
      [
        readers.read(session.id, seeds, {
          online: connected,
          low: low(originalBefore, size - Math.min(learnedShare, likedBefore.length)),
        }),
        readers.read(session.id, liked, {
          online: connected,
          low: low(likedBefore, Math.max(learnedShare, size - originalBefore.length)),
        }),
      ],
      { concurrency: "unbounded" },
    )).flat();
    const candidates = ytMusicEnabled() ? rank(seeds, true) : [];
    const likedCandidates = ytMusicEnabled() ? rank(liked, false) : [];
    found = [...candidates, ...likedCandidates];
    const songs = read.reduce((sum, { page }) => sum + (page?.songs.length ?? 0), 0);
    return {
      candidates,
      likedCandidates,
      ranked: songs,
      eligible: candidates.length + likedCandidates.length,
      refilled: read.every(({ page }) => page === null) ? null : songs,
    };
  });

/** Signals use already known genres; this path never looks an artist up. */
export const magicStreamedSong = (track: {
  readonly id: string;
  readonly artists: readonly string[];
}): MagicSong =>
  found.find((candidate) => candidate.trackId === track.id) ??
  magicYtSong({ trackId: track.id, artists: track.artists }, lookedUpProfileOf);
