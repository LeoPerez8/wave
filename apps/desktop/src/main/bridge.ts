/** Main's side of the bridge: one IPC handler per call in the contract. */
import { extname, isAbsolute, normalize } from "node:path";
import { Database } from "@wave/client";
import { libraryCounts } from "@wave/client/db/counts";
import * as Effect from "effect/Effect";
import { BRIDGE_CALLS, type BridgeCall, type BridgeContract } from "../shared/bridge.ts";
import { PLAYABLE_EXTENSIONS } from "../shared/playback.ts";
import { Playback } from "./playback/playback.ts";
import {
  validPlaybackCommand,
  validPlaybackSettings,
  validQueuePlace,
  validSleepTimerChoice,
} from "./playback/validation.ts";
import { Player } from "./audio/player.ts";
import type { AudioEngineError } from "./audio/supervisor.ts";
import { Kotlin } from "./kotlin/kotlin.ts";
import { DesktopLibrary } from "./library/library.ts";
import { Account } from "./account/accountLayer.ts";
import type { Page } from "../shared/bridge.ts";
import { BROWSE_KINDS, MAX_ROW_IDS_PAGE, type BrowseScope } from "../shared/browse.ts";
import { browseLetter, browseRowIds } from "./library/browse.ts";
import { toggleBrowseSort, togglePlaylistSort } from "./library/browseSort.ts";
import { readArtwork } from "./library/artwork.ts";
import { appearance, preference, savePreference } from "./preferences.ts";
import {
  SEARCH_ONLINE_SETTING,
  isSpotifyLibrarySource,
  libraryTableSortsFor,
  readSearchOnline,
  readThemeEdit,
  writeSearchOnline,
  type AppLanguage,
  ytTrackId,
} from "@wave/core";
import {
  MAX_TARGET_IDS,
  SONG_RUN_ACTIONS,
  type SongRunAction,
  type SongTarget,
} from "../shared/songActions.ts";
import { runSongAction, songMenu } from "./library/songActions.ts";
import {
  collectionMenu,
  runCollectionAction,
  runSelectionAction,
  selectionMenu,
  validCollectionTarget,
  validSelectionTarget,
} from "./library/collectionActions.ts";
import {
  COLLECTION_RUN_ACTIONS,
  SELECTION_RUN_ACTIONS,
  type CollectionActionOptions,
  type CollectionRunAction,
  type SelectionRunAction,
} from "../shared/collectionActions.ts";
import type { Appearance, DesktopVersionHistory } from "../shared/bridge.ts";
import { VIDEO_ID, YtMusic } from "./yt/ytMusic.ts";
import { Downloads } from "./downloads/downloadsLayer.ts";
import {
  MISSING_SONGS_ACTIONS,
  FAILED_REASON_ACTIONS,
  type DownloadMove,
  type FailedReasonAction,
  MISSING_SONGS_LISTS,
  type MissingSongsList,
  YT_SONGS_DOWNLOAD_ACTIONS,
  type YtSongsList,
} from "../shared/downloads.ts";
import type { MissingSongsDownloadAction, UpNextPlace, YtSongsDownloadAction } from "@wave/core";
import { createYtFeatureHandlers, playSearchSong } from "./yt/ytBridge.ts";
import { YtFeatures } from "./yt/ytServices.ts";
import type { YtListSongs } from "./downloads/downloads.ts";
import { Lyrics } from "./lyrics/lyrics.ts";
import { GeniusLyricsSearch } from "./lyrics/geniusLyricsSearchLayer.ts";
import { DesktopLinks } from "./links/layer.ts";
import { linkHandlers } from "./links/handlers.ts";
import { releaseDateHandlers } from "./library/releaseDateHandlers.ts";
import { artistPageHandlers } from "./artistPageHandlers.ts";
import { YtAccount } from "./yt/ytAccountLayer.ts";
import { SpotifyAccount } from "./spotify/spotifyAccountLayer.ts";
import { SpotifyImport } from "./spotify/spotifyImportLayer.ts";
import { SPOTIFY_IMPORT_MOST } from "../shared/spotifyImport.ts";
import { DesktopPlaylists } from "./library/playlists.ts";
import { playlistHandlers } from "./playlistHandlers.ts";
import { searchLibrary } from "./library/search.ts";
import { validWindowSettings } from "../shared/windowSettings.ts";
import { readWindowSettings, changeWindowSettings } from "./system/windowSettings.ts";
import { homeHandlers } from "./homeHandlers.ts";
import {
  miniPlayerHandlers,
  noMiniPlayer,
  type MiniPlayerCalls,
} from "./system/miniPlayerHandlers.ts";
import { statsHandlers } from "./statsHandlers.ts";
import { CardImages, cardImageHandlers } from "./cards/cardImages.ts";
import { historyHandlers } from "./historyHandlers.ts";
import { lyricsAndTagsHandlers } from "./lyricsAndTagsHandlers.ts";
import { HomeFollow } from "./follows/homeFollow.ts";
import { homeFollowHandlers } from "./follows/homeFollowHandlers.ts";
import { FollowedArtists } from "./follows/followedArtists.ts";
import { followsHandlers } from "./follows/followsHandlers.ts";
import { streamedHandlers } from "./yt/streamedHandlers.ts";
import { recognizeHandlers } from "./recognize/recognizeHandlers.ts";
import { Recognize } from "./recognize/recognizeLayer.ts";
import { runStreamedAction } from "./yt/streamedSong.ts";
import {
  clearRecentSearches,
  listRecentSearchesSync,
  rememberSearchSync,
} from "@wave/client/db/libraryQueries";

const validScope = (value: unknown): value is BrowseScope => {
  if (typeof value !== "object" || value === null) return false;
  const { kind, id, query, find } = value as BrowseScope;
  return (
    (find === undefined || (typeof find === "string" && find.length <= 500)) &&
    BROWSE_KINDS.includes(kind) &&
    (!["album", "artist", "playlist", "genre"].includes(kind) ||
      (Number.isSafeInteger(id) && id! > 0)) &&
    (query === undefined || (typeof query === "string" && query.length <= 500))
  );
};

const LIST_OF_LISTS = ["albums", "artists", "playlists", "genres"];

/** A page whose missing songs download together, and only that. */
const missingSongsList = (value: unknown): MissingSongsList | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, id } = value as MissingSongsList;
  return MISSING_SONGS_LISTS.includes(kind) && songId(id) ? { kind, id } : undefined;
};

const songId = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** A target of songs: a list of songs, and the ones named or all but the ones named. */
const validTarget = (value: unknown): value is SongTarget => {
  if (typeof value !== "object" || value === null) return false;
  const { scope } = value as SongTarget;
  if (!validScope(scope) || LIST_OF_LISTS.includes(scope.kind)) return false;
  const { ids, all, except } = value as { ids?: unknown; all?: unknown; except?: unknown };
  const keys = all === true ? except : ids;
  if (!(keys instanceof Float64Array) && !(Array.isArray(keys) && keys.length <= MAX_TARGET_IDS))
    return false;
  const validId = (id: unknown) =>
    songId(id) || (scope.kind === "playlist" && typeof id === "number" && songId(-id));
  return (all === true || (all === undefined && keys.length > 0)) && keys.every(validId);
};

/** What Search takes: typed text, as long as a query gets. */
const searchQuery = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 500;

const lyricTrackId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

const geniusRequestId = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
const validCollectionOptions = (value: unknown): value is CollectionActionOptions => {
  if (typeof value !== "object" || value === null) return false;
  const { here, selectable, surface } = value as CollectionActionOptions;
  return (
    (here === undefined || searchQuery(here)) &&
    (selectable === undefined || typeof selectable === "boolean") &&
    (surface === undefined || surface === "menu" || surface === "selection")
  );
};

/** A short list, whole, as a page. */
const allOf = <T>(items: readonly T[]): Page<T> => ({ items, offset: 0, total: items.length });

export type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

interface IpcMainLike {
  readonly handle: (channel: string, handler: IpcHandler) => void;
}

interface Runtime<R> {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
}

/** The services the calls use. */
export type BridgeServices =
  | Database
  | Player
  | Kotlin
  | DesktopLibrary
  | Playback
  | YtMusic
  | Downloads
  | YtFeatures
  | Account
  | Lyrics
  | GeniusLyricsSearch
  | DesktopPlaylists
  | DesktopLinks
  | HomeFollow
  | FollowedArtists
  | YtAccount
  | SpotifyAccount
  | CardImages
  | SpotifyImport
  | Recognize;

const refuse = (call: BridgeCall, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

/** An absolute path to a file the engine plays. */
const songPath = (value: unknown): string | undefined =>
  typeof value === "string" &&
  isAbsolute(value) &&
  PLAYABLE_EXTENSIONS.includes(extname(value).slice(1).toLowerCase())
    ? value
    : undefined;

const playerCall = <A>(
  run: (player: Player["Service"]) => Effect.Effect<A, AudioEngineError>,
): Effect.Effect<A, Error, Player> =>
  Effect.gen(function* () {
    return yield* run(yield* Player);
  }).pipe(
    // Only the message crosses IPC, so the window reads the engine's code from it.
    Effect.mapError((error) => new Error(`[${error.code}] ${error.message}`)),
  );

const kotlinCall = <A>(
  run: (
    kotlin: Kotlin["Service"],
  ) => Effect.Effect<A, { readonly code: string; readonly message: string }>,
): Effect.Effect<A, Error, Kotlin> =>
  Effect.gen(function* () {
    return yield* run(yield* Kotlin);
  }).pipe(Effect.mapError((error) => new Error(`[${error.code}] ${error.message}`)));

const libraryCall = <A>(run: (library: DesktopLibrary["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const library = yield* DesktopLibrary;
    return yield* Effect.tryPromise({ try: async () => run(library), catch: (error) => error });
  });

const playbackCall = <A>(run: (playback: Playback["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const playback = yield* Playback;
    return yield* Effect.tryPromise({ try: async () => run(playback), catch: (error) => error });
  });

const ytCall = <A>(run: (yt: YtMusic["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const yt = yield* YtMusic;
    return yield* Effect.tryPromise({ try: async () => run(yt), catch: (error) => error });
  });

/** At most a queue's worth of video ids. */
const videoIds = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 500 &&
  value.every((id) => typeof id === "string" && VIDEO_ID.test(id))
    ? (value as string[])
    : undefined;

const downloadsCall = <A>(run: (downloads: Downloads["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const downloads = yield* Downloads;
    return yield* Effect.tryPromise({ try: async () => run(downloads), catch: (error) => error });
  });

/** A YT Music list as a page names it: an album's page by its browse id, a mix by its id. */
const ytSongsList = (value: unknown): YtSongsList | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, id } = value as YtSongsList;
  if (typeof id !== "string") return undefined;
  if (kind === "album") return /^[A-Za-z0-9_-]{2,128}$/.test(id) ? { kind, id } : undefined;
  return kind === "discoverMix" && id.length > 0 && id.length <= 200 ? { kind, id } : undefined;
};

/** [run] on [list]'s songs as its page last read them; [unread] when it wasn't read. */
const ytListCall = <A, B>(
  list: YtSongsList,
  unread: B,
  run: (downloads: Downloads["Service"], found: YtListSongs) => A | Promise<A>,
) =>
  Effect.gen(function* () {
    const features = yield* YtFeatures;
    const downloads = yield* Downloads;
    return yield* Effect.tryPromise({
      try: async () => {
        const found = features.ytList(list);
        return found === null ? unread : await run(downloads, found);
      },
      catch: (error) => error,
    });
  });

/** A journal job's id: a video id, or a missing song's `missing:<trackId>`. */
const DOWNLOAD_ID = /^(?:[A-Za-z0-9_-]{11}|missing:[1-9]\d{0,15})$/;

/** At most a queue's worth of journal job ids. */
const downloadIds = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) &&
  value.length <= 500 &&
  value.every((id) => typeof id === "string" && DOWNLOAD_ID.test(id))
    ? (value as string[])
    : undefined;

/**
 * A move on the Downloads page: a waiting song (a job id) or a group (its key), onto another's
 * place or one step up or down.
 */
const downloadMove = (value: unknown): DownloadMove | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, from, to, step } = value as Record<string, unknown>;
  if (kind !== "song" && kind !== "group") return undefined;
  const named = (name: unknown): name is string =>
    typeof name === "string" &&
    (kind === "song" ? DOWNLOAD_ID.test(name) : name.length > 0 && name.length <= 300);
  if (!named(from)) return undefined;
  if (step === undefined) return named(to) ? { kind, from, to } : undefined;
  return to === undefined && (step === -1 || step === 1) ? { kind, from, step } : undefined;
};

/** At most a queue's worth of Track ids. */
const trackIds = (value: unknown): readonly number[] | undefined =>
  Array.isArray(value) && value.length > 0 && value.length <= 500 && value.every(songId)
    ? (value as number[])
    : undefined;

const validPage = (offset: unknown, limit: unknown, max = 200): boolean =>
  typeof offset === "number" &&
  Number.isSafeInteger(offset) &&
  offset >= 0 &&
  typeof limit === "number" &&
  Number.isSafeInteger(limit) &&
  limit >= 1 &&
  limit <= max;

const pageCall = <T>(
  call: BridgeCall,
  args: readonly unknown[],
  run: (library: DesktopLibrary["Service"], offset: number, limit: number) => Page<T>,
) => {
  const [offset, limit] = args;
  return validPage(offset, limit)
    ? libraryCall((library) => run(library, offset as number, limit as number))
    : refuse(call, "invalid page");
};

const accountCall = <A>(run: (account: Account["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const account = yield* Account;
    return yield* Effect.tryPromise({ try: async () => run(account), catch: (error) => error });
  });

const ytAccountCall = <A>(run: (account: YtAccount["Service"]) => A | Promise<A>) =>
  Effect.gen(function* () {
    const account = yield* YtAccount;
    return yield* Effect.tryPromise({ try: async () => run(account), catch: (error) => error });
  });

const spotifyAccountCall =
  <A>(call: BridgeCall, run: (account: SpotifyAccount["Service"]) => A | Promise<A>) =>
  (args: readonly unknown[]) =>
    args.length === 0
      ? Effect.gen(function* () {
          const account = yield* SpotifyAccount;
          return yield* Effect.tryPromise({
            try: async () => run(account),
            catch: () => new Error("Spotify account operation failed"),
          });
        })
      : refuse(call, "expected no arguments");

/** Runs a From Spotify call in the language main resolved: the window's own idea of it is never asked. */
const spotifyImportCall = <A>(
  run: (spotify: SpotifyImport["Service"], language: AppLanguage) => A | Promise<A>,
) =>
  Effect.gen(function* () {
    const spotify = yield* SpotifyImport;
    const { language } = (yield* Account).language();
    return yield* Effect.tryPromise({
      try: async () => run(spotify, language),
      catch: () => new Error("Spotify import failed"),
    });
  });

/** Picker rows' sources: Liked Songs or a playlist URI, each once. */
const spotifySources = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= SPOTIFY_IMPORT_MOST &&
  value.every((source) => typeof source === "string" && isSpotifyLibrarySource(source)) &&
  new Set(value).size === value.length;

/** What each call does; `args` come from the window and are checked here before use. */
type Handlers = {
  readonly [C in BridgeCall]: (
    args: readonly unknown[],
  ) => Effect.Effect<BridgeContract[C]["result"], unknown, BridgeServices>;
};

const createHandlers = (
  onAppearance: (mode: Appearance) => void,
  setLogin: (on: boolean) => Promise<void>,
  mediaBackend: () => "native" | "chromium",
  versionHistory: (offset: number, reload: boolean) => Promise<DesktopVersionHistory>,
  miniPlayer: MiniPlayerCalls,
): Handlers => {
  let loadedPath: string | undefined;
  const streamed = streamedHandlers();
  const checkAvailable = (path: string | undefined) =>
    Effect.gen(function* () {
      const library = yield* DesktopLibrary;
      if (path !== undefined && library.unavailable(path))
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
    });
  return {
    "system.mediaBackend": () => Effect.sync(mediaBackend),
    "settings.versionHistory": ([offset, reload]) =>
      typeof offset === "number" && validPage(offset, 1) && typeof reload === "boolean"
        ? Effect.promise(() => versionHistory(offset, reload))
        : refuse("settings.versionHistory", "invalid page"),
    "settings.window": () => Effect.map(Database, readWindowSettings),
    "settings.setWindow": ([change]) =>
      validWindowSettings(change)
        ? Effect.gen(function* () {
            const db = yield* Database;
            return yield* Effect.tryPromise(() => changeWindowSettings(db, change, setLogin));
          })
        : refuse("settings.setWindow", "invalid window setting"),
    ...createYtFeatureHandlers(validTarget),
    ...linkHandlers(validTarget),
    ...releaseDateHandlers(validTarget),
    ...artistPageHandlers(),
    ...streamed.handlers,
    "playback.view": () => playbackCall((p) => p.view()),
    "playback.start": ([scope, index, shuffle]) =>
      validScope(scope) &&
      !LIST_OF_LISTS.includes(scope.kind) &&
      (index === undefined ||
        (typeof index === "number" && Number.isSafeInteger(index) && index >= 0)) &&
      (shuffle === undefined || typeof shuffle === "boolean")
        ? scope.kind === "search" && typeof index === "number"
          ? playSearchSong(scope, index)
          : playbackCall((p) =>
              p.start(scope, index as number | undefined, shuffle as boolean | undefined),
            )
        : refuse("playback.start", "invalid play context"),
    "playback.startYt": ([ids, index, shuffle]) => {
      const songs = videoIds(ids);
      return songs !== undefined &&
        typeof index === "number" &&
        Number.isSafeInteger(index) &&
        index >= 0 &&
        index < songs.length &&
        (shuffle === undefined || typeof shuffle === "boolean")
        ? playbackCall((p) => p.startYt(songs, index, shuffle as boolean | undefined))
        : refuse("playback.startYt", "invalid songs");
    },
    "playback.command": ([command]) =>
      validPlaybackCommand(command)
        ? playbackCall((p) => p.command(command))
        : refuse("playback.command", "invalid command"),
    "playback.play": () => playbackCall((p) => p.play()),
    "playback.pause": () => playbackCall((p) => p.pause()),
    "playback.seek": ([ms]) =>
      typeof ms === "number" && Number.isFinite(ms) && ms >= 0
        ? playbackCall((p) => p.seek(ms))
        : refuse("playback.seek", "invalid time"),
    "playback.undo": () => playbackCall((p) => p.undo()),
    "playback.dismissUndo": () => playbackCall((p) => p.dismissUndo()),
    "playback.favorite": () => streamed.favoritePlaying,
    "playback.volume": ([value, muted]) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1 &&
      typeof muted === "boolean"
        ? playbackCall((p) => p.volume(value, muted))
        : refuse("playback.volume", "invalid volume"),
    "playback.queue": ([offset, limit]) =>
      typeof offset === "number" &&
      Number.isSafeInteger(offset) &&
      offset >= 0 &&
      typeof limit === "number" &&
      Number.isSafeInteger(limit) &&
      limit > 0 &&
      limit <= 200
        ? playbackCall((p) => p.queue(offset, limit))
        : refuse("playback.queue", "invalid page"),
    "playback.setSleepTimer": ([choice]) =>
      validSleepTimerChoice(choice)
        ? playbackCall((p) => p.setSleepTimer(choice))
        : refuse("playback.setSleepTimer", "invalid sleep timer"),
    "lyrics.song": ([trackId]) =>
      lyricTrackId(trackId)
        ? Effect.gen(function* () {
            const lyrics = yield* Lyrics;
            return yield* Effect.tryPromise({ try: () => lyrics.song(trackId), catch: (e) => e });
          })
        : refuse("lyrics.song", "invalid track id"),
    "lyrics.genius": ([trackId, requestId, phase]) =>
      lyricTrackId(trackId) &&
      geniusRequestId(requestId) &&
      (phase === "read" || phase === "translate")
        ? Effect.gen(function* () {
            const { genius } = yield* Account;
            return yield* Effect.tryPromise({
              try: () => genius.song(trackId, requestId, phase),
              catch: (error) => error,
            });
          })
        : refuse("lyrics.genius", "invalid request"),
    "lyrics.cancelGenius": ([requestId]) =>
      geniusRequestId(requestId)
        ? Effect.map(Account, (account) => account.genius.cancel(requestId))
        : refuse("lyrics.cancelGenius", "invalid request id"),
    "lyrics.searchOnline": ([query]) =>
      searchQuery(query)
        ? Effect.gen(function* () {
            const online = yield* GeniusLyricsSearch;
            return yield* Effect.tryPromise({ try: () => online.search(query), catch: (e) => e });
          })
        : refuse("lyrics.searchOnline", "invalid query"),
    "lyrics.openOnlineHit": ([id]) =>
      typeof id === "number" && Number.isSafeInteger(id) && id > 0
        ? Effect.gen(function* () {
            const online = yield* GeniusLyricsSearch;
            return yield* Effect.tryPromise({ try: () => online.open(id), catch: (e) => e });
          })
        : refuse("lyrics.openOnlineHit", "invalid hit"),
    "lyrics.translateOn": () => Effect.map(Lyrics, ({ translation }) => translation.on()),
    "lyrics.setTranslateOn": ([on]) =>
      typeof on === "boolean"
        ? Effect.map(Lyrics, ({ translation }) => {
            translation.setOn(on);
            return translation.on();
          })
        : refuse("lyrics.setTranslateOn", "invalid switch"),
    "lyrics.translation": ([trackId, language]) =>
      lyricTrackId(trackId) && (language === "en" || language === "pt-BR")
        ? Effect.gen(function* () {
            const { translation } = yield* Lyrics;
            return yield* Effect.tryPromise({
              try: () => translation.song(trackId, language),
              catch: (error) => error,
            });
          })
        : refuse("lyrics.translation", "invalid request"),
    "lyrics.karaokeOn": () => Effect.map(Lyrics, ({ karaoke }) => karaoke.on()),
    "lyrics.setKaraokeOn": ([on]) =>
      typeof on === "boolean"
        ? Effect.map(Lyrics, ({ karaoke }) => {
            karaoke.setOn(on);
            return karaoke.on();
          })
        : refuse("lyrics.setKaraokeOn", "invalid switch"),
    "settings.appearance": () =>
      Effect.gen(function* () {
        return appearance(yield* Database);
      }),
    "settings.language": () => Effect.map(Account, (it) => it.language()),
    "settings.setLanguage": ([choice]) =>
      choice === "system" || choice === "en" || choice === "pt-BR"
        ? Effect.map(Account, (it) => it.setLanguage(choice))
        : refuse("settings.setLanguage", "invalid language"),
    "settings.setAppearance": ([mode]) =>
      mode === "light" || mode === "dark" || mode === "system"
        ? Effect.gen(function* () {
            savePreference(yield* Database, "appearance", mode);
            onAppearance(mode);
          })
        : refuse("settings.setAppearance", "invalid appearance"),
    "settings.editTheme": ([raw]) => {
      const edit = readThemeEdit(raw);
      return edit === null
        ? refuse("settings.editTheme", "invalid theme edit")
        : Effect.map(Account, (it) => it.editTheme(edit));
    },
    "settings.playback": () => playbackCall((p) => p.settings()),
    "settings.setPlayback": ([change]) =>
      validPlaybackSettings(change)
        ? Effect.gen(function* () {
            const after = yield* playbackCall((p) => p.setSettings(change));
            // The change goes up to the account without waiting for the timed sync.
            (yield* Account).settingsEdited();
            return after;
          })
        : refuse("settings.setPlayback", "invalid playback settings"),
    "settings.outputs": () => playbackCall((p) => p.outputs()),
    "settings.setOutput": ([id]) =>
      id === null || (typeof id === "string" && id !== "" && id.length <= 1_000)
        ? playbackCall((p) => p.setOutput(id))
        : refuse("settings.setOutput", "invalid output"),
    "settings.ytMusic": () => ytCall((yt) => yt.enabled()),
    "settings.searchOnline": () =>
      Effect.map(Database, (db) => readSearchOnline(preference(db, SEARCH_ONLINE_SETTING) ?? null)),
    "settings.setSearchOnline": ([value]) =>
      value === "always" || value === "onDemand"
        ? Effect.map(Database, (db) =>
            savePreference(db, SEARCH_ONLINE_SETTING, writeSearchOnline(value) ?? ""),
          )
        : refuse("settings.setSearchOnline", "invalid setting"),
    "settings.setYtMusic": ([on]) =>
      typeof on === "boolean"
        ? ytCall((yt) => yt.setEnabled(on))
        : refuse("settings.setYtMusic", "invalid setting"),
    "yt.artwork": ([url]) =>
      typeof url === "string" && url.length <= 2_000
        ? ytCall((yt) => yt.artwork(url))
        : refuse("yt.artwork", "invalid address"),
    "downloads.view": () => downloadsCall((d) => d.view()),
    "downloads.rows": ([offset, limit, failedShown]) =>
      validPage(offset, limit) && (failedShown === undefined || typeof failedShown === "boolean")
        ? downloadsCall((d) => d.rows(offset as number, limit as number, failedShown === true))
        : refuse("downloads.rows", "invalid page"),
    "downloads.move": ([value]) => {
      const move = downloadMove(value);
      return move === undefined
        ? refuse("downloads.move", "invalid move")
        : downloadsCall((d) => d.move(move));
    },
    "downloads.failedReason": ([reason, action]) =>
      typeof reason === "string" &&
      reason.length > 0 &&
      reason.length <= 500 &&
      FAILED_REASON_ACTIONS.includes(action as FailedReasonAction)
        ? downloadsCall((d) => d.failedReason(reason, action as FailedReasonAction))
        : refuse("downloads.failedReason", "invalid reason or action"),
    "downloads.ytList": ([value]) => {
      const list = ytSongsList(value);
      return list === undefined
        ? refuse("downloads.ytList", "invalid list")
        : ytListCall(list, null, (d, found) => d.ytListView(found));
    },
    "downloads.ytListAction": ([action, value]) => {
      const list = ytSongsList(value);
      return list === undefined ||
        !YT_SONGS_DOWNLOAD_ACTIONS.includes(action as YtSongsDownloadAction)
        ? refuse("downloads.ytListAction", "invalid action or list")
        : ytListCall(list, undefined, (d, found) =>
            d.ytListAction(action as YtSongsDownloadAction, found),
          );
    },
    "downloads.list": ([value]) => {
      const list = missingSongsList(value);
      return list === undefined
        ? refuse("downloads.list", "invalid list")
        : downloadsCall((d) => d.listView(list));
    },
    "downloads.yt": ([ids]) => {
      const asked = videoIds(ids);
      return asked === undefined
        ? refuse("downloads.yt", "invalid songs")
        : downloadsCall((d) => d.yt(asked));
    },
    "downloads.missing": ([ids]) => {
      const asked = trackIds(ids);
      return asked === undefined
        ? refuse("downloads.missing", "invalid songs")
        : downloadsCall((d) => d.missing(asked));
    },
    "downloads.missingAction": ([action, value]) => {
      const list = value === undefined ? undefined : missingSongsList(value);
      return MISSING_SONGS_ACTIONS.includes(action as MissingSongsDownloadAction) &&
        (value === undefined || list !== undefined)
        ? downloadsCall((d) => d.missingAction(action as MissingSongsDownloadAction, list))
        : refuse("downloads.missingAction", "invalid action or list");
    },
    "downloads.retry": ([ids]) => {
      const asked = ids === undefined ? undefined : downloadIds(ids);
      return ids !== undefined && asked === undefined
        ? refuse("downloads.retry", "invalid downloads")
        : downloadsCall((d) => d.retry(asked));
    },
    "downloads.cancel": ([ids]) => {
      const asked = downloadIds(ids);
      return asked === undefined
        ? refuse("downloads.cancel", "invalid downloads")
        : downloadsCall((d) => d.cancel(asked));
    },
    "downloads.clearFailed": () => downloadsCall((d) => d.clearFailed()),
    "downloads.folder": () => downloadsCall((d) => d.folder()),
    "downloads.pickFolder": () => downloadsCall((d) => d.pickFolder()),
    "downloads.bestQuality": () => downloadsCall((d) => d.bestQuality()),
    "downloads.setBestQuality": ([on]) =>
      typeof on === "boolean"
        ? downloadsCall((d) => d.setBestQuality(on))
        : refuse("downloads.setBestQuality", "invalid setting"),
    "account.view": () => accountCall((a) => a.view()),
    "account.signIn": () => accountCall((a) => a.signIn()),
    "account.cancelSignIn": () => accountCall((a) => a.cancelSignIn()),
    "account.signOut": () => accountCall((a) => a.signOut()),
    "account.signOutEverywhere": () => accountCall((a) => a.signOutEverywhere()),
    "account.deleteAccount": () => accountCall((a) => a.deleteAccount()),
    "account.answerInvitation": () => accountCall((a) => a.answerInvitation()),
    "account.answerBringYourMusic": () => accountCall((a) => a.answerBringYourMusic()),
    "ytAccount.view": () => ytAccountCall((a) => a.view()),
    "ytAccount.signIn": () => ytAccountCall((a) => a.signIn()),
    "ytAccount.cancelSignIn": () => ytAccountCall((a) => a.cancelSignIn()),
    "ytAccount.signOut": () => ytAccountCall((a) => a.signOut()),
    "ytAccount.playlists": ([language]) =>
      language === "en" || language === "pt-BR"
        ? ytAccountCall((a) => a.playlists(language))
        : refuse("ytAccount.playlists", "invalid language"),
    "library.artwork": ([hash, large]) =>
      typeof hash === "string" && /^[a-f0-9]{40}$/.test(hash) && typeof large === "boolean"
        ? Effect.gen(function* () {
            const db = yield* Database;
            return yield* Effect.promise(() => readArtwork(db, hash, large));
          })
        : refuse("library.artwork", "invalid artwork"),
    "library.cover": ([kind, id, large]) =>
      (kind === "song" || kind === "album" || kind === "artist") &&
      songId(id) &&
      typeof large === "boolean"
        ? Effect.gen(function* () {
            const library = yield* DesktopLibrary;
            return yield* Effect.promise(
              () => library.cover?.(kind, id as number, large) ?? Promise.resolve(null),
            );
          })
        : refuse("library.cover", "invalid identity"),
    "library.browse": ([scope, offset, limit]) =>
      validScope(scope)
        ? pageCall("library.browse", [offset, limit], (library, offset, limit) =>
            library.browse(scope, offset, limit),
          )
        : refuse("library.browse", "invalid scope"),
    "library.rowIds": ([scope, offset, limit]) =>
      validScope(scope) && validPage(offset, limit, MAX_ROW_IDS_PAGE)
        ? Effect.gen(function* () {
            return browseRowIds(yield* Database, scope, offset as number, limit as number);
          })
        : refuse("library.rowIds", "invalid scope or page"),
    "library.letter": ([scope, letter]) =>
      validScope(scope) && typeof letter === "string" && /^[a-z0-9]$/i.test(letter)
        ? Effect.gen(function* () {
            return browseLetter(yield* Database, scope, letter);
          })
        : refuse("library.letter", "invalid letter or scope"),
    "library.sortBy": ([kind, key, playlistId]) =>
      kind === "playlist" &&
      typeof key === "string" &&
      typeof playlistId === "number" &&
      Number.isSafeInteger(playlistId) &&
      playlistId > 0
        ? Effect.gen(function* () {
            // A playlist's sort is the account's: the phone shows the same one.
            if (!togglePlaylistSort(yield* Database, playlistId, key))
              return yield* refuse("library.sortBy", "sort is not offered for this playlist");
            (yield* Account).settingsEdited();
          })
        : typeof kind === "string" &&
            typeof key === "string" &&
            playlistId === undefined &&
            libraryTableSortsFor(kind).some((sort) => sort.key === key)
          ? Effect.map(Database, (db) => toggleBrowseSort(db, kind, key))
          : refuse("library.sortBy", "sort is not offered for this list"),
    "library.counts": () =>
      Effect.gen(function* () {
        return libraryCounts(yield* Database);
      }),
    "library.scanStatus": () => libraryCall((library) => library.status()),
    "library.refresh": () =>
      libraryCall((library) => {
        void library.refresh();
      }),
    "library.songs": (args) =>
      pageCall("library.songs", args, (library, offset, limit) => library.songs(offset, limit)),
    "library.roots": (args) =>
      pageCall("library.roots", args, (library, offset, limit) => library.folders(offset, limit)),
    "library.exclusions": (args) =>
      pageCall("library.exclusions", args, (library, offset, limit) =>
        library.exclusions(offset, limit),
      ),
    "library.addRoot": () => libraryCall((library) => library.pickRoot()),
    "library.exclude": () => libraryCall((library) => library.pickExclusion()),
    "library.removeRoot": ([path]) =>
      typeof path === "string" && isAbsolute(path)
        ? libraryCall((library) => library.removeRoot(path))
        : refuse("library.removeRoot", "invalid folder"),
    "library.include": ([path]) =>
      typeof path === "string" && isAbsolute(path)
        ? libraryCall((library) => library.include(path))
        : refuse("library.include", "invalid folder"),
    "songs.states": ([ids]) => {
      const asked = trackIds(ids);
      return asked === undefined || asked.length > 200
        ? refuse("songs.states", "invalid songs")
        : Effect.gen(function* () {
            const downloads = yield* Downloads;
            const playback = yield* Playback;
            return {
              offset: 0,
              total: asked.length,
              items: asked.map((id) => ({
                id,
                download: downloads.status(id),
                failed: playback.fileFailed(id),
              })),
            };
          });
    },
    "collections.actions": ([target, options]) =>
      validCollectionTarget(target) && (options === undefined || validCollectionOptions(options))
        ? Effect.gen(function* () {
            const db = yield* Database;
            const yt = yield* YtMusic;
            const downloads = yield* Downloads;
            return collectionMenu(db, target, options ?? {}, yt.enabled(), downloads.status);
          })
        : refuse("collections.actions", "invalid collection or options"),
    "collections.run": ([target, action, playlistId]) =>
      validCollectionTarget(target) &&
      COLLECTION_RUN_ACTIONS.includes(action as CollectionRunAction) &&
      (action === "addToPlaylist" ? songId(playlistId) : playlistId === undefined)
        ? Effect.gen(function* () {
            const db = yield* Database;
            const playback = yield* Playback;
            const downloads = yield* Downloads;
            const yt = yield* YtMusic;
            const library = yield* DesktopLibrary;
            return yield* Effect.tryPromise(() =>
              runCollectionAction(
                { db, playback, downloads, yt, unavailable: library.unavailable },
                target,
                action as CollectionRunAction,
                playlistId as number | undefined,
              ),
            );
          })
        : refuse("collections.run", "invalid collection, action or playlist"),
    "collections.selectionActions": ([target]) =>
      validSelectionTarget(target, validTarget)
        ? Effect.gen(function* () {
            return selectionMenu(yield* Database, target, (yield* YtMusic).enabled());
          })
        : refuse("collections.selectionActions", "invalid selection"),
    "collections.runSelection": ([target, action, playlistId, at]) =>
      validSelectionTarget(target, validTarget) &&
      SELECTION_RUN_ACTIONS.includes(action as SelectionRunAction) &&
      (action === "addToPlaylist" ? songId(playlistId) : playlistId === undefined) &&
      validQueuePlace(action, at)
        ? Effect.gen(function* () {
            const db = yield* Database;
            const playback = yield* Playback;
            const downloads = yield* Downloads;
            const yt = yield* YtMusic;
            const library = yield* DesktopLibrary;
            return yield* Effect.tryPromise(() =>
              runSelectionAction(
                {
                  db,
                  playback,
                  downloads,
                  yt,
                  unavailable: library.unavailable,
                  download: downloads.missing,
                  downloadStreamed: (song) =>
                    runStreamedAction(
                      {
                        db,
                        ytMusic: yt.enabled,
                        downloads,
                        queue: async (type, id) =>
                          playback.command({ type, trackIds: [ytTrackId(id)] }),
                        changed: playback.refresh,
                      },
                      song,
                      "download",
                    ),
                },
                target,
                action as SelectionRunAction,
                playlistId as number | undefined,
                at as UpNextPlace | undefined,
              ),
            );
          })
        : refuse("collections.runSelection", "invalid selection, action or playlist"),
    "songs.actions": ([target, surface]) =>
      validTarget(target) && (surface === "menu" || surface === "selection")
        ? Effect.gen(function* () {
            return songMenu(yield* Database, target, surface, (yield* YtMusic).enabled());
          })
        : refuse("songs.actions", "invalid songs or surface"),
    "songs.showInFolder": (args) =>
      args.length === 1 && songId(args[0])
        ? libraryCall((library) => library.showInFolder(args[0] as number))
        : refuse("songs.showInFolder", "invalid song"),
    "songs.run": ([target, action, playlistId, at]) =>
      validTarget(target) &&
      SONG_RUN_ACTIONS.includes(action as SongRunAction) &&
      (action === "addToPlaylist" ? songId(playlistId) : playlistId === undefined) &&
      validQueuePlace(action, at) &&
      (action !== "removeFromPlaylist" || target.scope.kind === "playlist")
        ? Effect.gen(function* () {
            const db = yield* Database;
            const library = yield* DesktopLibrary;
            const playback = yield* Playback;
            const downloads = yield* Downloads;
            const playlists = yield* DesktopPlaylists;
            const yt = yield* YtMusic;
            return yield* Effect.tryPromise({
              try: () =>
                runSongAction(
                  {
                    db,
                    download: downloads.missing,
                    queue: (type, trackIds, songs) =>
                      yt.withSongs(songs, () =>
                        playback.command(
                          type === "addToQueue" && at !== undefined
                            ? { type, trackIds: [...trackIds], at: at as UpNextPlace }
                            : { type, trackIds: [...trackIds] },
                        ),
                      ),
                    runStreamed: (song, action) =>
                      runStreamedAction(
                        {
                          db,
                          ytMusic: yt.enabled,
                          downloads,
                          queue: async (type, id) =>
                            playback.command({ type, trackIds: [ytTrackId(id)] }),
                          changed: playback.refresh,
                        },
                        song,
                        action,
                      ),
                    removeSongs: (trackIds) => library.removeSongs(trackIds),
                    fixSongs: (trackIds) => downloads.fixSongs(trackIds),
                    changed: playback.refresh,
                    removeFromPlaylist: playlists.removeSongs,
                  },
                  target,
                  action as SongRunAction,
                  playlistId as number | undefined,
                ),
              catch: (error) => error,
            });
          })
        : refuse("songs.run", "invalid songs, action or playlist"),
    "player.load": ([path]) => {
      const song = songPath(path);
      return song === undefined
        ? refuse("player.load", "not an absolute path to an audio file")
        : Effect.gen(function* () {
            const path = yield* libraryCall((library) => library.resolvePath(song));
            yield* checkAvailable(path);
            const status = yield* playerCall((player) => player.load(normalize(path)));
            loadedPath = path;
            return status;
          });
    },
    "player.play": () =>
      Effect.gen(function* () {
        yield* checkAvailable(loadedPath);
        return yield* playerCall((player) => player.play());
      }),
    "player.pause": () => playerCall((player) => player.pause()),
    "player.seek": ([positionMs]) =>
      typeof positionMs === "number" && Number.isFinite(positionMs) && positionMs >= 0
        ? playerCall((player) => player.seek(positionMs))
        : refuse("player.seek", "not a time in milliseconds"),
    "player.status": () => playerCall((player) => player.status()),
    "tags.read": ([path]) => {
      const song = songPath(path);
      return song === undefined
        ? refuse("tags.read", "not an absolute path to an audio file")
        : kotlinCall((kotlin) => kotlin.readTags(song));
    },
    ...playlistHandlers(validTarget),
    ...homeHandlers,
    ...statsHandlers,
    ...cardImageHandlers,
    ...historyHandlers,
    ...lyricsAndTagsHandlers,
    ...homeFollowHandlers,
    ...followsHandlers,
    ...miniPlayerHandlers(miniPlayer),
    ...recognizeHandlers,
    "search.library": ([query]) =>
      searchQuery(query)
        ? Effect.gen(function* () {
            return searchLibrary(yield* Database, query);
          })
        : refuse("search.library", "invalid query"),
    "search.recent": () =>
      Effect.gen(function* () {
        return allOf(listRecentSearchesSync(yield* Database));
      }),
    "search.remember": ([query]) =>
      searchQuery(query)
        ? Effect.gen(function* () {
            return allOf(rememberSearchSync(yield* Database, query, Date.now()));
          })
        : refuse("search.remember", "invalid query"),
    "search.clearRecent": () =>
      Effect.gen(function* () {
        clearRecentSearches(yield* Database);
      }),
    "spotifyAccount.view": spotifyAccountCall("spotifyAccount.view", (a) => a.view()),
    "spotifyAccount.signIn": spotifyAccountCall("spotifyAccount.signIn", (a) => a.signIn()),
    "spotifyAccount.cancelSignIn": spotifyAccountCall("spotifyAccount.cancelSignIn", (a) =>
      a.cancelSignIn(),
    ),
    "spotifyAccount.signOut": spotifyAccountCall("spotifyAccount.signOut", (a) => a.signOut()),
    "spotifyAccount.check": spotifyAccountCall("spotifyAccount.check", (a) => a.check()),
    "spotifyAccount.photo": spotifyAccountCall("spotifyAccount.photo", (a) => a.photo()),
    "spotifyImport.library": (args) =>
      args.length === 1 && typeof args[0] === "boolean"
        ? spotifyImportCall((spotify, language) => spotify.library(args[0] as boolean, language))
        : refuse("spotifyImport.library", "invalid request"),
    "spotifyImport.run": (args) => {
      const [sources, download] = args;
      return args.length === 2 && spotifySources(sources) && typeof download === "boolean"
        ? spotifyImportCall((spotify, language) => spotify.run(sources, download, language))
        : refuse("spotifyImport.run", "invalid playlists");
    },
    "spotifyImport.cancel": (args) =>
      args.length === 0
        ? spotifyImportCall((spotify) => spotify.cancel())
        : refuse("spotifyImport.cancel", "expected no arguments"),
    "spotifyImport.missing": (args) => {
      const [playlistId] = args;
      return args.length === 1 && songId(playlistId)
        ? spotifyImportCall((spotify) => spotify.missing(playlistId as number))
        : refuse("spotifyImport.missing", "invalid playlist");
    },
    "spotifyImport.artwork": (args) => {
      const [source] = args;
      return args.length === 1 && typeof source === "string" && isSpotifyLibrarySource(source)
        ? spotifyImportCall((spotify) => spotify.artwork(source))
        : refuse("spotifyImport.artwork", "invalid playlist");
    },
    "spotifyShare.playlist": (args) =>
      args.length === 1 && songId(args[0])
        ? Effect.gen(function* () {
            const links = yield* DesktopLinks;
            const account = yield* SpotifyAccount;
            const playlistId = args[0] as number;
            return yield* Effect.tryPromise({
              try: () => links.shareToSpotify(playlistId, account),
              catch: () => new Error("Sharing the playlist failed"),
            });
          })
        : refuse("spotifyShare.playlist", "invalid playlist"),
  };
};

/** Registers every call, answering only frames `isTrusted` accepts. */
export const registerBridge = (
  ipcMain: IpcMainLike,
  runtime: Runtime<BridgeServices>,
  isTrusted: (event: unknown) => boolean,
  onAppearance: (mode: Appearance) => void = () => {},
  setLogin: (on: boolean) => Promise<void> = async () => {
    throw new Error("Login registration unavailable");
  },
  mediaBackend: () => "native" | "chromium" = () => "native",
  versionHistory: (
    offset: number,
    reload: boolean,
  ) => Promise<DesktopVersionHistory> = async () => ({
    version: "",
    channel: null,
    currentListed: false,
    releases: { items: [], offset: 0, total: 0 },
  }),
  miniPlayer: MiniPlayerCalls = noMiniPlayer,
): void => {
  const handlers = createHandlers(onAppearance, setLogin, mediaBackend, versionHistory, miniPlayer);
  for (const call of BRIDGE_CALLS) {
    const handler: (args: readonly unknown[]) => Effect.Effect<unknown, unknown, BridgeServices> =
      handlers[call];
    ipcMain.handle(call, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error(`Refused ${call} from an untrusted frame`);
      return runtime.runPromise(handler(args));
    });
  }
};
