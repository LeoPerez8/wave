/**
 * YouTube Music's pages, Discover and the Magic Queue as main's services, over the Library,
 * the queue and the JVM: what `ytPages.ts`, `discover.ts` and `magicQueue.ts` decide, read from
 * the database and wired to playback. The window reaches them through `ytBridge.ts`.
 */
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectAlbums } from "@wave/client/db/albums";
import { listArtistsSync } from "@wave/client/db/libraryQueries";
import { mixSongsPage } from "@wave/client/db/mixInputs";
import { selectCountedPlays } from "@wave/client/db/playTotals";
import { selectPlaylistEntryVideoIdsPage } from "@wave/client/db/playlists";
import { selectVideoIds, trackQuery } from "@wave/client/db/tracks";
import {
  catalogueOf,
  discoverMixCaption,
  discoverMixName,
  libraryArtistFinder,
  libraryFinder,
  libraryAlbumFinder,
  libraryReleaseFinder,
  localDay,
  parseTrackId,
  readContinueQueue,
  searchSongTap,
  readSearchOnline,
  searchOnlineAlways,
  readDiscoverMixLevel,
  readMixSliders,
  parseHomeArrangement,
  DISCOVER_LEVEL_SETTING as DISCOVER_LEVEL,
  DISCOVER_SLIDERS_SETTING as DISCOVER_SLIDERS,
  HOME_ARRANGEMENT_SETTING,
  hasFindQuery,
  SEARCH_ONLINE_SETTING as SEARCH_ONLINE,
  ytTrackId,
  type AppLanguage,
  type PlayedSeedArtist,
  type QueueContinuationSeed,
  type DiscoverLibrarySong,
  type DiscoverMixSong,
  type DiscoverSongPlays,
  type YtAlbumSong,
  type YtArtistAlbum,
  type YtSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { BrowseKind, BrowseScope } from "../../shared/browse.ts";
import type { PlayStart } from "../../shared/playerView.ts";
import { ytRow, type YtSearchPage } from "../../shared/yt.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import type { YtSongsList } from "../../shared/downloads.ts";
import type { YtListSongs } from "../downloads/downloads.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import { browseLibrary, browseSongs, browseTrackIds, playlistSongs } from "../library/browse.ts";
import { DesktopLibrary } from "../library/library.ts";
import { targetSongs } from "../library/songActions.ts";
import { Playback } from "../playback/playback.ts";
import { preference, savePreference } from "../preferences.ts";
import { syncedPreference } from "../sync/desktopSync.ts";
import { createDiscover, type DiscoverShape, type PlacedMixSong } from "./discover.ts";
import {
  createMagicQueue,
  type MagicQueueInput,
  type MagicQueueShape,
  type MagicQueueSong,
} from "./magicQueue.ts";
import { createYtPages, type YtPagesShape, type YtRelatedRead } from "./ytPages.ts";
import { createArtistSection, type ArtistSectionShape } from "./artistSection.ts";
import { createPlaylistSuggestions, type PlaylistSuggestionsShape } from "./playlistSuggestions.ts";
import { createAlbumSection, type AlbumSectionShape } from "./albumSection.ts";
import { YtMusic } from "./ytMusic.ts";

/** Where the Magic Queue's session is kept across launches. */
export const MAGIC_QUEUE_SESSION = "playback.magicQueue";
/** Settings › Playback › Continue with Magic Queue, as the account syncs it. */
const CONTINUE_QUEUE = "settings.continueQueue";

export interface YtFeaturesShape {
  readonly pages: YtPagesShape;
  readonly discover: DiscoverShape;
  readonly magicQueue: MagicQueueShape;
  /** A Library artist page's YouTube Music section. */
  readonly artistSection: ArtistSectionShape;
  /** A playlist page's Recommended songs. */
  readonly playlistSuggestions: PlaylistSuggestionsShape;
  /** A Library album page's YouTube Music section. */
  readonly albumSection: AlbumSectionShape;
  /**
   * Search's YouTube Music answer for [query]: its songs, artists and albums, and which of them
   * the Library already has. One search that fails fails them all, as on the phone.
   */
  readonly search: (query: string) => Promise<YtSearchPage>;
  /**
   * The Library album each of the YT Music artist [name]'s [releases] is, by browse id; a
   * release the Library doesn't have is left out.
   */
  readonly libraryReleases: (
    name: string,
    releases: readonly YtArtistAlbum[],
  ) => ReadonlyMap<string, number>;
  /**
   * A YT Music list's songs as its page last read them, what the Library has of them and the
   * source their downloads group under; null when its page wasn't read this session.
   */
  readonly ytList: (list: YtSongsList) => YtListSongs | null;
  /** The Related tab of the song playing; nothing when no song plays. */
  readonly related: () => Promise<YtRelatedRead>;
  /** Plays a Magic Queue of [target]'s songs; false when none of them can play. */
  readonly startMagicQueue: (target: SongTarget) => Promise<boolean>;
  /**
   * Plays the Library song at [index] of Search's songs for [scope] (Core's `searchSongTap`):
   * its faithful Magic Queue with YT Music on, the song alone with it off, or its download.
   */
  readonly playSearchSong: (scope: BrowseScope, index: number) => Promise<PlayStart>;
  /**
   * Plays today's mix [id] from its song [index] as its page lists them, as a queue that goes on
   * from the mix; with [shuffle], its songs shuffled. False for a mix that's gone.
   */
  readonly playMix: (id: string, index: number, shuffle?: boolean) => Promise<boolean>;
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
  readonly known: (song: YtSong) => boolean;
  /** The Library song with a file [song] is, by id (Core's `libraryFinder`); else null. */
  readonly find: (song: YtSong) => number | null;
  /** Whether the Library has the YT Music artist [name] (Core's `libraryArtistFinder`). */
  readonly hasArtist: (name: string) => boolean;
  /** Whether the Library has [release] (Core's `libraryReleaseFinder`). */
  readonly hasAlbum: (release: YtArtistAlbum) => boolean;
  /**
   * The Library album the YT Music artist [name]'s [release] is, by its id: an album of the
   * Library artist that name is (Core's `libraryArtistFinder`, `libraryAlbumFinder`); else null.
   */
  readonly artistAlbum: (name: string, release: { readonly title: string }) => number | null;
}

/** Built on first use: most reads never ask about artists or albums. */
const lazily = <A>(build: () => A): (() => A) => {
  let built: { readonly value: A } | null = null;
  return () => (built ??= { value: build() }).value;
};

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
  const artists = listArtistsSync(db).map((artist) => ({
    id: artist.id,
    name: artist.name,
    songs: artist.trackCount,
  }));
  const artistNamed = lazily(() => libraryArtistFinder(artists));
  const albums = lazily(() => selectAlbums(db, undefined));
  const releaseOf = lazily(() => libraryReleaseFinder(artistNamed(), albums()));
  const albumFinders = new Map<
    number,
    (release: { readonly title: string }) => { id: number } | null
  >();
  return {
    songs,
    byId: new Map(songs.map((song) => [song.id, song])),
    artists,
    known: (song) => find(song) !== null,
    find: (song) => find(song)?.id ?? null,
    hasArtist: (name) => artistNamed()(name) !== null,
    hasAlbum: (release) => releaseOf()(release) !== null,
    artistAlbum: (name, release) => {
      const artist = artistNamed()(name);
      if (artist === null) return null;
      let find = albumFinders.get(artist.id);
      if (find === undefined) {
        find = libraryAlbumFinder(artist.id, albums());
        albumFinders.set(artist.id, find);
      }
      return find(release)?.id ?? null;
    },
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

/** A song of a mix as the queue names it. */
const mixTrackId = (song: DiscoverMixSong): string =>
  song.source === "stream" ? ytTrackId(song.song.videoId) : String(song.track.id);

/** A song of a mix's page as the queue names it. */
const placedTrackId = (song: PlacedMixSong): string =>
  song.source === "stream" ? ytTrackId(song.song.videoId) : String(song.track);

const LISTS: readonly BrowseKind[] = ["album", "artist", "playlist"];

/** YtFeatures over the Library, playback and the JVM; [online] is the system's connection. */
export const ytFeaturesLayer = (options: {
  readonly online: () => boolean;
  /** The app's language, for the name a mix's downloads group under; absent, English. */
  readonly language?: () => AppLanguage;
}) =>
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

      let mixCached:
        | {
            readonly revision: number;
            readonly songs: readonly DiscoverLibrarySong[];
            readonly plays: readonly DiscoverSongPlays[];
          }
        | undefined;
      /** The songs with a file as the mixes read them, genre tags and counted plays included. */
      const mixLibrary = () => {
        const { revision } = library.status();
        if (mixCached?.revision !== revision) {
          const { byId } = current();
          const songs: DiscoverLibrarySong[] = [];
          for (let after = 0; ;) {
            const page = mixSongsPage(db, after);
            const last = page.at(-1);
            if (last === undefined) break;
            for (const song of page)
              if (byId.has(song.id)) songs.push({ ...song, durationMs: song.durationMs ?? 0 });
            after = last.id;
          }
          const counted = selectCountedPlays(
            db,
            songs.map((song) => song.id),
          );
          mixCached = {
            revision,
            songs,
            plays: [...counted].map(([id, countedPlays]) => ({ id, countedPlays })),
          };
        }
        return { songs: mixCached.songs, plays: mixCached.plays };
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
          ...mixLibrary(),
          artists: current().artists.map((artist) => ({
            id: artist.id,
            name: artist.name,
            songCount: artist.songs,
          })),
        }),
        entryVideoIds: () => {
          const videos = new Set<string>();
          for (let after: number | null = 0; after !== null;) {
            const page = selectPlaylistEntryVideoIdsPage(db, after);
            for (const video of page.videos) videos.add(video);
            after = page.next;
          }
          return [...videos];
        },
        known: (song) => current().known(song),
        track: (id) => current().byId.has(id),
        find: (song) => current().find(song),
        pages,
        today: () => localDay(Date.now()),
        online: options.online,
        enabled: yt.enabled,
        readSettings: () => ({
          level: readDiscoverMixLevel(preference(db, DISCOVER_LEVEL) ?? null),
          ...readMixSliders(preference(db, DISCOVER_SLIDERS) ?? null),
        }),
        saveSettings: ({ level, faithfulness, popularity }) => {
          savePreference(db, DISCOVER_LEVEL, String(level));
          // The phone's format, defaults included, so a move back to them replaces the last.
          savePreference(db, DISCOVER_SLIDERS, JSON.stringify({ faithfulness, popularity }));
        },
        rows: () =>
          parseHomeArrangement(syncedPreference(db, HOME_ARRANGEMENT_SETTING)).discoverRows,
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
          if (mix !== undefined && mix.songs.some((song) => played.has(mixTrackId(song))))
            return {
              seed: {
                kind: "list",
                id: mix.id,
                title: discoverMixName(
                  mix.seed,
                  catalogueOf(options.language?.() ?? "en", "desktop"),
                ),
              },
              songs: songsOf(
                mix.songs.flatMap((song) => (song.source === "library" ? [song.track.id] : [])),
              ),
              streamed: mix.songs.flatMap((song) => (song.source === "stream" ? [song.song] : [])),
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

      const artistSection = createArtistSection({
        db,
        enabled: yt.enabled,
        online: options.online,
        // The desktop has no mobile data: Always on Wi-Fi is Always.
        always: () =>
          searchOnlineAlways(readSearchOnline(preference(db, SEARCH_ONLINE) ?? null), {
            onMobileData: false,
          }),
        now: Date.now,
        keep: yt.keep,
        search: pages.searchArtists,
        page: pages.artistWhole,
      });
      const albumSection = createAlbumSection({
        db,
        enabled: yt.enabled,
        online: options.online,
        always: () =>
          searchOnlineAlways(readSearchOnline(preference(db, SEARCH_ONLINE) ?? null), {
            onMobileData: false,
          }),
        now: Date.now,
        artist: artistSection,
        release: pages.album,
      });

      const playlistSuggestions = createPlaylistSuggestions({
        db,
        pages,
        ytMusic: yt.enabled,
        online: options.online,
        changed: playback.refresh,
        log: (line) => process.stderr.write(`[WaveTiming] ${line}\n`),
      });

      let related: { readonly videoId: string; readonly read: Promise<YtRelatedRead> } | undefined;

      return {
        pages,
        discover,
        magicQueue,
        artistSection,
        playlistSuggestions,
        albumSection,
        search: async (query) => {
          const [found, catalog] = await Promise.all([yt.search(query), pages.catalog(query)]);
          const status = found.status !== "ok" ? found.status : catalog.status;
          if (status !== "ok")
            return {
              status,
              songs: { items: [], offset: 0, total: 0 },
              artists: [],
              albums: [],
              inLibrary: { songs: [], artists: [], albums: [] },
            };
          const library = current();
          const items = found.songs.map(ytRow);
          return {
            status,
            songs: { items, offset: 0, total: items.length },
            artists: catalog.artists,
            albums: catalog.albums,
            inLibrary: {
              songs: found.songs.filter(library.known).map((song) => song.videoId),
              artists: catalog.artists
                .filter((artist) => library.hasArtist(artist.name))
                .map((artist) => artist.browseId),
              albums: catalog.albums.filter(library.hasAlbum).map((album) => album.browseId),
            },
          };
        },
        libraryReleases: (name, releases) => {
          const library = current();
          return new Map(
            releases.flatMap((release) => {
              const id = library.artistAlbum(name, release);
              return id === null ? [] : [[release.browseId, id] as const];
            }),
          );
        },
        ytList: (list) => {
          if (list.kind === "discoverMix") {
            const mix = discover.mix(list.id);
            if (mix === undefined) return null;
            // Every song it streams, new or familiar, as the phone's mix page downloads.
            const strings = catalogueOf(options.language?.() ?? "en", "desktop");
            return {
              songs: mix.songs.flatMap((song) => (song.source === "stream" ? [song.song] : [])),
              inLibrary: current().known,
              origin: { kind: "mix", id: mix.id, name: discoverMixCaption(mix, strings).title },
            };
          }
          const album = pages.albumSongs(list.id);
          return album === null
            ? null
            : {
                songs: album.songs,
                inLibrary: current().known,
                origin: { kind: "album", id: list.id, name: album.title },
              };
        },
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
          if (!yt.enabled()) return false;
          const songs = songsOf(targetSongs(db, target));
          const { scope } = target;
          const whole =
            "all" in target &&
            target.except.length === 0 &&
            scope.id !== undefined &&
            !hasFindQuery(scope.find ?? "") &&
            LISTS.includes(scope.kind);
          const title = whole ? browseLibrary(db, scope, 0, 1).hero?.title : undefined;
          if (whole && title !== undefined) {
            const streamed =
              scope.kind === "playlist"
                ? (playlistSongs(db, scope.id!) ?? []).flatMap((entry) =>
                    "song" in entry ? [entry.song] : [],
                  )
                : [];
            if (songs.length === 0 && streamed.length === 0) return false;
            return magicQueue.start({
              seed: {
                kind: scope.kind as "album" | "artist" | "playlist",
                id: String(scope.id),
                title,
              },
              songs,
              streamed,
            });
          }
          const first = songs[0];
          if (first === undefined) return false;
          return magicQueue.start({
            seed: {
              kind: songs.length === 1 ? "track" : "list",
              id: String(first.id),
              title: first.title,
            },
            songs,
            streamed: [],
          });
        },
        playSearchSong: async (scope, index) => {
          const id = Number(browseTrackIds(db, scope)[index]);
          const track = browseSongs(db, [id])[0];
          const tap =
            track === undefined
              ? undefined
              : searchSongTap({ source: "library", track }, { ytMusic: yt.enabled() });
          const seeded = tap?.play === "magicQueue" ? songsOf([id]) : [];
          // A song whose drive is disconnected says so, as it does played alone.
          if (
            tap?.play === "magicQueue" &&
            tap.from === "library" &&
            seeded.length > 0 &&
            !library.unavailable(tap.track.path!) &&
            (await magicQueue.start({
              seed: tap.seed,
              songs: seeded,
              streamed: [],
              faithful: true,
            }))
          )
            return { kind: "playing", streamed: 0, leftOut: 0 };
          return playback.start(scope, index);
        },
        playMix: async (id, index, shuffle) => {
          const songs = discover.placed(id);
          if (songs === undefined || index < 0 || index >= songs.length) return false;
          await playback.dispatch({
            type: "play",
            trackIds: songs.map(placedTrackId),
            // Shuffle starts anywhere among them, as a Library list's does.
            startIndex: shuffle === true ? undefined : index,
            context: { kind: "discoverMix", id },
            ...(shuffle === true ? { shuffle } : {}),
          });
          return true;
        },
      } satisfies YtFeaturesShape;
    }),
  );
