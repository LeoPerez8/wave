/**
 * YouTube Music's pages, Discover and the Magic Queue as main's services, over the Library,
 * the queue and the JVM: what `ytPages.ts`, `discover.ts` and `magicQueue.ts` decide, read from
 * the database and wired to playback. The window reaches them through `ytBridge.ts`.
 */
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { listArtistsSync } from "@wave/client/db/libraryQueries";
import { selectCountedPlays } from "@wave/client/db/playTotals";
import { selectVideoIds, trackQuery } from "@wave/client/db/tracks";
import {
  libraryFinder,
  localDay,
  parseTrackId,
  readContinueQueue,
  ytTrackId,
  type PlayedSeedArtist,
  type QueueContinuationSeed,
  type YtAlbumSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { BrowseKind } from "../../shared/browse.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import { browseLibrary, browseTrackIds } from "../library/browse.ts";
import { DesktopLibrary } from "../library/library.ts";
import { targetSongs } from "../library/songActions.ts";
import { Playback } from "../playback/playback.ts";
import { preference, savePreference } from "../preferences.ts";
import { syncedPreference } from "../sync/desktopSync.ts";
import { createDiscover, type DiscoverShape } from "./discover.ts";
import {
  createMagicQueue,
  type MagicQueueInput,
  type MagicQueueShape,
  type MagicQueueSong,
} from "./magicQueue.ts";
import { createYtPages, type YtPagesShape, type YtRelatedRead } from "./ytPages.ts";
import { YtMusic } from "./ytMusic.ts";

/** Where the Magic Queue's session is kept across launches. */
export const MAGIC_QUEUE_SESSION = "playback.magicQueue";
/** Settings › Playback › Continue with Magic Queue, as the account syncs it. */
const CONTINUE_QUEUE = "settings.continueQueue";

export interface YtFeaturesShape {
  readonly pages: YtPagesShape;
  readonly discover: DiscoverShape;
  readonly magicQueue: MagicQueueShape;
  /** The Related tab of the song playing; nothing when no song plays. */
  readonly related: () => Promise<YtRelatedRead>;
  /** Plays a Magic Queue of [target]'s songs; false when none of them can play. */
  readonly startMagicQueue: (target: SongTarget) => Promise<boolean>;
  /** Plays today's mix [id] from its song [index], as a queue that goes on from the mix. */
  readonly playMix: (id: string, index: number) => Promise<boolean>;
}

export class YtFeatures extends Context.Service<YtFeatures, YtFeaturesShape>()(
  "@wave/desktop/YtFeatures",
) {}

interface LibraryRead {
  readonly songs: readonly MagicQueueSong[];
  readonly byId: ReadonlyMap<number, MagicQueueSong>;
  readonly artists: readonly {
    readonly id: number;
    readonly name: string;
    readonly songs: number;
  }[];
  readonly known: (song: YtAlbumSong) => boolean;
}

/** The Library's songs with a file, its artists and its counted plays, as these features weigh them. */
const readLibrary = (db: LibraryDatabase): LibraryRead => {
  const rows = trackQuery(db, "files").all();
  const videoIds = selectVideoIds(
    db,
    rows.map((row) => row.id),
  );
  const songs = rows.map((row): MagicQueueSong => {
    const videoId = videoIds.get(row.id);
    return {
      id: row.id,
      title: row.title,
      artist: row.artist,
      artistIds: row.artistIds,
      durationMs: row.durationMs ?? 0,
      genre: row.genre ?? null,
      ...(videoId === undefined ? {} : { videoId }),
    };
  });
  const find = libraryFinder(songs);
  return {
    songs,
    byId: new Map(songs.map((song) => [song.id, song])),
    artists: listArtistsSync(db).map((artist) => ({
      id: artist.id,
      name: artist.name,
      songs: artist.trackCount,
    })),
    known: (song) => find(song) !== null,
  };
};

/** Each artist's counted plays, summed over their songs, most played first. */
const playedArtists = (db: LibraryDatabase, library: LibraryRead): PlayedSeedArtist[] => {
  const plays = selectCountedPlays(
    db,
    library.songs.map((song) => song.id),
  );
  const byArtist = new Map<number, number>();
  for (const song of library.songs) {
    const counted = plays.get(song.id) ?? 0;
    if (counted === 0) continue;
    for (const id of new Set(song.artistIds)) byArtist.set(id, (byArtist.get(id) ?? 0) + counted);
  }
  return library.artists
    .flatMap((artist) => {
      const countedPlays = byArtist.get(artist.id);
      return countedPlays === undefined ? [] : [{ id: artist.id, name: artist.name, countedPlays }];
    })
    .sort((a, b) => b.countedPlays - a.countedPlays);
};

const LISTS: readonly BrowseKind[] = ["album", "artist", "playlist"];

/** YtFeatures over the Library, playback and the JVM; [online] is the system's connection. */
export const ytFeaturesLayer = (options: { readonly online: () => boolean }) =>
  Layer.effect(
    YtFeatures,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const yt = yield* YtMusic;
      const library = yield* DesktopLibrary;
      const playback = yield* Playback;

      let cached: { readonly revision: number; readonly read: LibraryRead } | undefined;
      /** The Library as of its last scan or change, read once per revision. */
      const current = (): LibraryRead => {
        const { revision } = library.status();
        if (cached?.revision !== revision) cached = { revision, read: readLibrary(db) };
        return cached.read;
      };

      const pages = createYtPages({
        call: (method, params) => Effect.runPromise(kotlin.call(method, params)),
        keep: yt.keep,
        enabled: yt.enabled,
      });
      const discover = createDiscover({
        played: () => playedArtists(db, current()),
        library: () => ({
          trackIds: current().songs.map((song) => song.id),
          artists: current().artists.map((artist) => ({
            id: artist.id,
            name: artist.name,
            songCount: artist.songs,
          })),
        }),
        known: (song) => current().known(song),
        pages,
        today: () => localDay(Date.now()),
      });

      /** [ids]' Library songs, in order; ids no longer playable are left out. */
      const songsOf = (ids: readonly number[]): MagicQueueSong[] =>
        ids.flatMap((id) => current().byId.get(id) ?? []);
      const streamedOf = (trackIds: readonly string[]): YtAlbumSong[] =>
        trackIds.flatMap((trackId) => {
          const ref = parseTrackId(trackId);
          return ref?.kind === "yt" ? (yt.song(ref.videoId) ?? []) : [];
        });

      /** The list a queue that ends came from, as the phone reads it (`readQueueContinuationSeed`). */
      const continuation = (source: QueueContinuationSeed): MagicQueueInput | null => {
        if (source.kind === "album" || source.kind === "artist" || source.kind === "playlist") {
          const scope = { kind: source.kind, id: Number(source.id) } as const;
          const title = browseLibrary(db, scope, 0, 1).hero?.title;
          if (title === undefined) return null;
          return {
            seed: { ...source, title },
            songs: songsOf(browseTrackIds(db, scope).map(Number)),
            streamed: [],
          };
        }
        if (source.kind === "discoverMix") {
          const mix = discover.mix(source.id);
          const played = new Set(source.trackIds);
          // A mix rebuilt under the same id has other new songs: none the queue played.
          if (mix !== undefined && mix.songs.some((song) => played.has(ytTrackId(song.videoId))))
            return {
              seed: { kind: "list", id: mix.id, title: mix.name },
              songs: [],
              streamed: mix.songs,
            };
          const last = source.trackIds.at(-1);
          return last === undefined
            ? null
            : continuation({ kind: "list", id: last, trackIds: source.trackIds });
        }
        if (source.kind === "list") {
          const songs = songsOf([
            ...new Set(
              source.trackIds.flatMap((trackId) => {
                const ref = parseTrackId(trackId);
                return ref?.kind === "library" ? [ref.id] : [];
              }),
            ),
          ]);
          const streamed = streamedOf(source.trackIds);
          const last = parseTrackId(source.id);
          const title =
            last?.kind === "library"
              ? songs.find((song) => song.id === last.id)?.title
              : last?.kind === "yt"
                ? yt.song(last.videoId)?.title
                : undefined;
          return title === undefined
            ? null
            : { seed: { kind: "list", id: source.id, title }, songs, streamed };
        }
        const ref = parseTrackId(source.id);
        if (ref?.kind === "library") {
          const song = current().byId.get(ref.id);
          return song === undefined
            ? null
            : { seed: { ...source, title: song.title }, songs: [song], streamed: [] };
        }
        const song = ref?.kind === "yt" ? yt.song(ref.videoId) : undefined;
        return song === undefined
          ? null
          : { seed: { ...source, title: song.title }, songs: [], streamed: [song] };
      };

      const magicQueue = createMagicQueue({
        queue: playback.queueState,
        dispatch: playback.dispatch,
        library: () => current(),
        pages,
        ytMusic: yt.enabled,
        online: options.online,
        continueQueue: () => readContinueQueue(syncedPreference(db, CONTINUE_QUEUE)),
        playing: playback.playing,
        sleepTimer: playback.sleepTimer,
        // The Buffer's look-ahead isn't on the desktop: a queue goes on at its last song.
        ahead: () => null,
        continuation,
        load: () => preference(db, MAGIC_QUEUE_SESSION) ?? null,
        save: (json) => savePreference(db, MAGIC_QUEUE_SESSION, json),
      });
      const unwatch = playback.watch({
        queueChanged: magicQueue.queueChanged,
        playEnded: magicQueue.playEnded,
      });
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          unwatch();
          await magicQueue.settled();
        }),
      );

      let related: { readonly videoId: string; readonly read: Promise<YtRelatedRead> } | undefined;

      return {
        pages,
        discover,
        magicQueue,
        related: async () => {
          const song = playback.view().current;
          if (song === null) return { status: "ok", songs: [], artists: [] };
          const videoId =
            song.videoId ??
            current().byId.get(song.id)?.videoId ??
            (await pages.findSong({
              title: song.title,
              artists: [song.artist],
              durationMs: song.durationMs,
            }));
          if (videoId === null)
            return {
              status: !yt.enabled() ? "disabled" : options.online() ? "ok" : "offline",
              songs: [],
              artists: [],
            };
          // The same song's tab is read once, unless it failed.
          if (related?.videoId !== videoId) {
            const read = pages.related(videoId, { title: song.title, artist: song.artist });
            related = { videoId, read };
            void read.then((done) => {
              if (done.status !== "ok" && related?.read === read) related = undefined;
            });
          }
          return related.read;
        },
        startMagicQueue: async (target) => {
          const ids = targetSongs(db, target);
          const songs = songsOf(ids);
          const first = songs[0];
          if (first === undefined) return false;
          const { scope } = target;
          const whole =
            "all" in target &&
            target.except.length === 0 &&
            scope.id !== undefined &&
            LISTS.includes(scope.kind);
          const title = whole ? browseLibrary(db, scope, 0, 1).hero?.title : undefined;
          return magicQueue.start({
            seed:
              whole && title !== undefined
                ? {
                    kind: scope.kind as "album" | "artist" | "playlist",
                    id: String(scope.id),
                    title,
                  }
                : songs.length === 1
                  ? { kind: "track", id: String(first.id), title: first.title }
                  : { kind: "list", id: String(first.id), title: first.title },
            songs,
            streamed: [],
          });
        },
        playMix: async (id, index) => {
          const mix = discover.mix(id);
          if (mix === undefined || index < 0 || index >= mix.songs.length) return false;
          await playback.dispatch({
            type: "play",
            trackIds: mix.songs.map((song) => ytTrackId(song.videoId)),
            startIndex: index,
            context: { kind: "discoverMix", id },
          });
          return true;
        },
      } satisfies YtFeaturesShape;
    }),
  );
