/** Magic Queue reads its seed's radio and ranks it with the last available Wave signals. */
import {
  catalogSeedKey,
  recordingMatches,
  type MixKnownSongs,
  magicLibrarySongs,
  magicSeedProfile,
  magicYtSong,
  rankRadioSongs,
  type ArtistGraph,
  type CatalogSong,
  type GenreProfileOf,
  type MagicSession,
  type MagicSong,
  type MixSliders,
  type TasteProfile,
} from "@wave/core";
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
import { createSongRadioSession, type SongRadioSeed } from "./songRadioSession";

const pages = createRadioPageCatalog({
  read: () => Storage.getItemSync("candidateCatalog.radioPages"),
  write: (value) => Storage.setItemSync("candidateCatalog.radioPages", value),
});
const sessions = new Map<string, ReturnType<typeof createSongRadioSession<unknown, never>>>();
let found: readonly MagicSong[] = [];

/** Reads only when online. A cached first batch starts the live refresh in the background. */
export const magicQueueYtCandidates = (
  session: MagicSession,
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
    if (!ytMusicEnabled()) return { candidates: [], ranked: 0, eligible: 0, refilled: null };
    const context = yield* Effect.context<LibraryStore>();
    const seed: SongRadioSeed = session.radioSeed ?? {
      id: session.seed.kind === "artist" ? `artist:${session.seed.id}` : `song:${session.seed.id}`,
      title: session.seed.title,
      artists: session.radioArtists,
      durationMs: null,
      ...(session.seedVideoIds[0] === undefined ? {} : { videoId: session.seedVideoIds[0] }),
      ...(session.seed.kind === "artist" ? { kind: "artist" as const } : {}),
    };
    let radio = sessions.get(session.id);
    if (radio === undefined) {
      const cached = pages.get(seed.id);
      radio = createSongRadioSession(seed, {
        cached,
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
            for (const artist of seed.artists)
              yield* noteRadioNow(artist, page.songs).pipe(Effect.provide(context));
          }),
        fallback: (name) =>
          appLog(
            "info",
            "WaveRecommendations",
            `Magic Queue: no song match for ${seed.title}; using ${name}'s artist radio`,
          ),
      });
      sessions.set(session.id, radio);
      if (sessions.size > 20) sessions.delete(sessions.keys().next().value!);
    }
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
    const rank = () => {
      const current = sessionNow?.() ?? session;
      // Old artist radios still provide an offline fallback until an ordered page is saved.
      const fallback = catalog
        .filter((entry) =>
          entry.radios.some((r) => seed.artists.some((name) => catalogSeedKey(name) === r.seed)),
        )
        .map((entry) => entry.song);
      const songs = (radio.current()?.songs ?? (connected ? [] : fallback)).filter(
        (song) => !("video" in song && song.video === true),
      );
      const exclude = new Set(current.used);
      for (const videoId of session.seedVideoIds) exclude.add(`yt:${videoId}`);
      return rankRadioSongs(
        { artists: seed.artists, profile: magicSeedProfile(session, profileOf) },
        {
          pages: [{ id: seed.id, artists: seed.artists, songs }],
          graph,
          taste,
          profileOf,
          library: playable.map(mapLibrary),
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
    const before = rank();
    const size = session.batches === 0 ? 9 : 10;
    const low =
      before.length < size ||
      before.filter((song) => song.source === "stream").length < Math.round(size * session.ytShare);
    const page = yield* radio.read({ online: connected, low });
    const candidates = ytMusicEnabled() ? rank() : [];
    found = candidates;
    return {
      candidates,
      ranked: page?.songs.length ?? 0,
      eligible: candidates.length,
      refilled: page === null ? null : page.songs.length,
    };
  });

/** Signals use already known genres; this path never looks an artist up. */
export const magicStreamedSong = (track: {
  readonly id: string;
  readonly artists: readonly string[];
}): MagicSong =>
  found.find((candidate) => candidate.trackId === track.id) ??
  magicYtSong({ trackId: track.id, artists: track.artists }, lookedUpProfileOf);
