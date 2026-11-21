import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, openTestDatabase, star, type TestDatabase } from "@wave/client/testing";
import { creditSplits } from "@wave/client/db/credits";
import { stampPreference } from "@wave/client/db/sync";
import { syncCycle } from "@wave/client/sync/syncCycle";
import { catalogueOf, recordingMatchTitle, scanPath, type SyncClock } from "@wave/core";
import { sql } from "drizzle-orm";
import { createPlaylist } from "@wave/client/db/playlists";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { exposeBridge } from "../preload/expose.ts";
import { BRIDGE_CALLS, type WaveBridge } from "../shared/bridge.ts";
import type { PlaybackStatus } from "../shared/playback.ts";
import type { LanguageView } from "../shared/language.ts";
import {
  answer,
  type AddonEngine,
  type AudioRequest,
  type ResolveAnswer,
} from "./audio/protocol.ts";
import { playerLayer } from "./audio/player.ts";
import type { AudioEvents } from "./audio/supervisor.ts";
import { kotlinLayer } from "./kotlin/kotlin.ts";
import type { KotlinEvents } from "./kotlin/supervisor.ts";
import type { SongTags } from "../shared/tags.ts";
import { libraryLayer } from "./database.ts";
import { playbackLayer } from "./playback/playback.ts";
import { registerBridge, type IpcHandler } from "./bridge.ts";
import { DesktopLibrary, desktopLibraryLayer } from "./library/library.ts";
import { preference } from "./preferences.ts";
import { ytMusicLayer } from "./yt/ytMusic.ts";
import { desktopLinksLayer } from "./links/layer.ts";
import { ytFeaturesLayer } from "./yt/ytServices.ts";
import { ytAccountLayer } from "./yt/ytAccountLayer.ts";
import { spotifyAccountLayer } from "./spotify/spotifyAccountLayer.ts";
import { spotifyImportLayer } from "./spotify/spotifyImportLayer.ts";
import type { YtBrowserOutcome } from "./yt/ytBrowserSignIn.ts";
import { createYtSessions, ytSessionStore } from "./yt/ytSessionStore.ts";
import { lyricsLayer } from "./lyrics/lyrics.ts";
import { accountLayer } from "./account/accountLayer.ts";
import { withHomeFollow } from "./follows/homeFollow.ts";
import { downloadsLayer } from "./downloads/downloadsLayer.ts";
import { desktopPlaylistsLayer } from "./library/playlists.ts";
import { createWaveAccount, type WaveAccountService } from "./account/account.ts";
import { sessionStore } from "./account/sessionStore.ts";
import { desktop, keyring } from "./account/testAccount.ts";
import { pullAll } from "../../../sync/src/testing.ts";
import { fakeClock } from "../../../../packages/core/src/testSyncClock.ts";
import { recordPlay } from "@wave/client/db/playHistory";
import {
  DOWNLOAD_ARTIST_PHOTOS_SETTING,
  editHomeArrangement,
  parseHomeArrangement,
  storedHomeArrangement,
} from "@wave/core";

const trusted = { senderFrame: "window" };

test("Lyrics and tags keeps the account's switches, refuses other keys and runs Fix Songs", async () => {
  await withFile(async (file) => {
    const first = connect(file);
    const wave = first.exposed.get("wave") as WaveBridge;
    try {
      assert.deepEqual(await wave.lyricsAndTags.view(), {
        fixSongsOnline: true,
        downloadArtistPhotos: true,
        geniusInsights: true,
        fixRun: null,
        artistPhotos: 0,
      });
      assert.deepEqual(await wave.lyricsAndTags.fixLibrary(), { results: [], skipped: 0 });
      const off = await wave.lyricsAndTags.set({
        fixSongsOnline: false,
        downloadArtistPhotos: false,
      });
      assert.equal(off.fixSongsOnline, false);
      assert.equal(off.downloadArtistPhotos, false);
      await assert.rejects(
        first.handlers.get("lyricsAndTags.set")!(trusted, { genius: true }),
        /refused/i,
      );
      await assert.rejects(wave.lyricsAndTags.fixLibrary(), /lookups-off/);
      await wave.lyricsAndTags.cancelFix();
      assert.equal((await wave.lyricsAndTags.clearArtistPhotos()).artistPhotos, 0);
    } finally {
      await first.runtime.dispose();
    }
    const second = connect(file);
    try {
      const reopened = (second.exposed.get("wave") as WaveBridge).lyricsAndTags;
      assert.equal((await reopened.view()).downloadArtistPhotos, false);
      assert.equal((await reopened.set({ fixSongsOnline: true })).fixSongsOnline, true);
    } finally {
      await second.runtime.dispose();
    }
  });
});

test("a Lyrics and tags switch goes up to the account without waiting for the timed sync", async () => {
  await withFile(async (file) => {
    const app = await desktop();
    const phone = await app.service.signIn();
    const { clock, pass } = fakeClock();
    const { runtime, exposed } = connect(file, undefined, { service: app.open(), clock });
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await wave.account.signIn();
      // The sync that signing in starts ends before the switch moves.
      await pass(10_000);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await wave.lyricsAndTags.set({ downloadArtistPhotos: false });
      await pass(10_000);
      let pushed: readonly unknown[] = [];
      for (let tries = 0; tries < 10 && pushed.length === 0; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        pushed = (await pullAll(app.service, phone)).preferences.filter(
          (row) => (row as { id?: unknown }).id === DOWNLOAD_ARTIST_PHOTOS_SETTING,
        );
      }
      assert.equal(pushed.length, 1);
    } finally {
      await runtime.dispose();
    }
  });
});

test("the language choice is validated, resolves once in main and survives reopening", async () => {
  await withFile(async (file) => {
    const first = connect(file);
    const wave = first.exposed.get("wave") as WaveBridge;
    try {
      assert.deepEqual(await wave.settings.language(), { choice: "system", language: "en" });
      await wave.settings.setLanguage("pt-BR");
      assert.deepEqual(await wave.settings.language(), { choice: "pt-BR", language: "pt-BR" });
      await assert.rejects(first.handlers.get("settings.setLanguage")!(trusted, "fr"), /refused/i);
      assert.equal((await wave.settings.language()).language, "pt-BR");
    } finally {
      await first.runtime.dispose();
    }
    const second = connect(file);
    try {
      const reopened = second.exposed.get("wave") as WaveBridge;
      assert.deepEqual(await reopened.settings.language(), { choice: "pt-BR", language: "pt-BR" });
      await reopened.settings.setLanguage("system");
      assert.deepEqual(await reopened.settings.language(), { choice: "system", language: "en" });
    } finally {
      await second.runtime.dispose();
    }
  });
});

test("Home follows the account's arrangement and plays its ranked list with Home context", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const first = addTrack(db, { title: "Pink Moon", artist: "Nick Drake" });
          const second = addTrack(db, { title: "Road", artist: "Nick Drake" });
          for (const [id, at] of [
            [first, 100],
            [first, 200],
            [second, 300],
          ] as const)
            recordPlay(db, {
              trackId: String(id),
              startedAt: at,
              counted: true,
              listenedMs: 16000,
              durationMs: 180000,
              source: "desktop",
              endReason: "skipped",
              context: null,
            });
          star(db, second, 400);
          const order = parseHomeArrangement(null);
          const stored = storedHomeArrangement(
            editHomeArrangement(order, {
              move: { from: order.sections.indexOf("favorites"), to: 0 },
            }),
          );
          db.run(
            sql`INSERT INTO desktop_synced_preferences(key,value) VALUES('settings.homeArrangement',${stored!})`,
          );
        }),
      );
      const home = await wave.home.view();
      assert.equal(home.items[0]?.id, "favorites");
      await wave.home.play("most-played", 1);
      assert.equal((await wave.playback.view()).current?.title, "Road");
      assert.deepEqual(
        (await wave.playback.queue(0, 10)).items.map((r) => r.title),
        ["Pink Moon", "Road"],
      );
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* Database;
          assert.deepEqual(
            db.get(
              sql`SELECT context_type AS kind, context_id AS id FROM play_events ORDER BY id DESC LIMIT 1`,
            ),
            { kind: "home", id: "most-played" },
          );
        }),
      );
      const call = (section: unknown, index: unknown) =>
        handlers.get("home.play")!(trusted, section, index);
      await assert.rejects(call("recently-added", 0), /refused/i);
      await assert.rejects(call("favorites", -1), /refused/i);
      await assert.rejects(call("favorites", 10), /refused/i);
      // Nobody followed: both follow sections have no card, and a card is named by a key.
      assert.deepEqual(await wave.home.follow(), { releases: [], shows: [] });
      assert.equal(await wave.home.followCheck(), false);
      assert.deepEqual(await wave.home.openRelease("deezer:1"), { kind: "notFound" });
      assert.equal(await wave.home.releaseArtwork("deezer:1"), null);
      await assert.rejects(handlers.get("home.openRelease")!(trusted, 7), /refused/i);
      await assert.rejects(handlers.get("home.releaseArtwork")!(trusted, ""), /refused/i);
    } finally {
      await runtime.dispose();
    }
  });
});

/** Main's handlers wired to a preload through an in-memory IPC, as Electron does. */
/** An audio process in memory, whose engine records what it was asked. */
const audioInMemory = () => {
  const engineCalls: string[] = [];
  /** Each song's Normalize Volume gain as it was loaded or lined up, and the files measured. */
  const gains: string[] = [];
  const measured: string[] = [];
  /** Files whose name is here won't open. */
  const broken = new Set<string>();
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: AddonEngine = {
    load: (path, key, gainDb) => {
      if (broken.has(basename(path))) throw new Error("[decode] can't open the file");
      engineCalls.push(`load ${path}`);
      gains.push(`${basename(path)} ${gainDb}`);
      status = { state: "paused", positionMs: 0, durationMs: 1_000, ...(key ? { key } : {}) };
      return status;
    },
    play: () => {
      if (status.state === "idle") throw new Error("[nothing-loaded] no song is loaded");
      status = { ...status, state: "playing" };
    },
    pause: () => void (status = { ...status, state: "paused" }),
    seek: (positionMs) => void (status = { ...status, positionMs }),
    status: () => status,
    preload: (path) => void (path === undefined || engineCalls.push(`preload ${path}`)),
    transitions: () => [],
    setVolume: (volume) => void engineCalls.push(`volume ${volume}`),
    setCrossfade: (seconds) => void engineCalls.push(`settings crossfade ${seconds}`),
    setNormalize: (on) => void engineCalls.push(`settings normalize ${on}`),
    // Measurements are never answered here: the in-memory process pushes no events.
    measure: (path) => void measured.push(path),
    cancelMeasurements: () => undefined,
    measurements: () => [],
  };
  const fork = (events: AudioEvents) => ({
    send: (request: AudioRequest | ResolveAnswer) =>
      "resolved" in request || queueMicrotask(() => events.message(answer(engine, request))),
    kill: () => setImmediate(events.exit),
  });
  return { layer: playerLayer({ fork }), engineCalls, gains, measured, broken };
};

/** Tags as the shared Kotlin reads them, for a song titled `title`. */
const tagsTitled = (title: string): SongTags => ({
  title,
  artist: "Nick Drake",
  artists: ["Nick Drake"],
  album: "Pink Moon",
  albumArtist: null,
  albumArtists: [],
  genre: null,
  genres: [],
  releaseDate: null,
  year: "1972",
  trackNumber: "1",
  discNumber: null,
  compilation: false,
  durationMs: 124_000,
  sampleRate: 44_100,
  bitrateKbps: 900,
  advisory: null,
  loudnessTags: null,
});

/** A YouTube Music song as the JVM's search answers it. */
const ytSongNamed = (videoId: string, title: string) => ({
  videoId,
  title,
  artists: ["Nick Drake"],
  album: "Pink Moon",
  albumId: "MPREb_pinkmoon",
  durationMs: 124_000,
  artworkUrl: "https://lh3.googleusercontent.com/cover=w120-h120",
  explicit: false,
  videoType: "MUSIC_VIDEO_TYPE_ATV",
});

/**
 * A JVM in memory that reads tags as the shared Kotlin does and searches YouTube Music, and
 * records the paths it read and the YT calls it got. `ytError` makes every YT call fail.
 */
const jvmInMemory = () => {
  const reads: string[] = [];
  const yt: string[] = [];
  const downloads: string[] = [];
  const state = {
    ytError: undefined as string | undefined,
    /** What the JVM answers a YT call by name, ahead of its own answers. */
    answers: {} as Record<string, unknown>,
  };
  const spawn = (events: KotlinEvents) => ({
    write: (text: string) => {
      const { id, method, params } = JSON.parse(text) as {
        id: number;
        method: string;
        params: { path: string };
      };
      let answer: unknown;
      if (method === "readLyrics") {
        answer = { id, result: { embedded: null, sidecar: `[00:01.00]${basename(params.path)}` } };
      } else if (method === "readTags") {
        reads.push(params.path);
        answer = params.path.includes("unreadable")
          ? { id, error: { code: "ERR_UNEXPECTED", message: "FileNotFoundException" } }
          : { id, result: tagsTitled(basename(params.path)) };
      } else if (/^(downloads?|soulseek|tags)\./.test(method)) {
        downloads.push(`${method} ${JSON.stringify(params)}`);
        answer = { id, result: downloadAnswers[method] ?? null };
      } else {
        yt.push(`${method} ${JSON.stringify(params)}`);
        answer =
          state.ytError !== undefined && method !== "setYtMusic"
            ? { id, error: { code: state.ytError, message: "no" } }
            : method in state.answers
              ? { id, result: state.answers[method] }
              : method === "search"
                ? {
                    id,
                    result: {
                      songs: [
                        ytSongNamed("abcdefghijk", "Pink Moon"),
                        ytSongNamed("bcdefghijkl", "Road"),
                      ],
                      continuation: null,
                    },
                  }
                : method === "songRadio"
                  ? {
                      id,
                      result: {
                        songs: Array.from({ length: 12 }, (_, n) => ({
                          ...ytSongNamed(`radio${String(n).padStart(6, "0")}`, `Radio ${n}`),
                          artists: [`Singer ${n}`],
                        })),
                        continuation: null,
                      },
                    }
                  : method === "artist"
                    ? {
                        id,
                        result: {
                          name: "Nick Drake",
                          songs: [ytSongNamed("abcdefghijk", "Pink Moon")],
                          albums: [{ browseId: "MPREb_pinkmoon", title: "Pink Moon", year: 1972 }],
                          singles: [],
                          similar: [{ name: "John Martyn", browseId: "UCjohnmartyn" }],
                        },
                      }
                    : method === "searchArtists"
                      ? {
                          id,
                          result: [
                            { name: "Nick Drake", browseId: "UCnickdrake", audience: 900 },
                            { name: "Nick Drake Tribute", browseId: "UCtribute", audience: 3 },
                          ],
                        }
                      : method === "searchAlbums"
                        ? {
                            id,
                            result: [
                              {
                                kind: "album",
                                browseId: "MPREb_pinkmoon",
                                title: "Pink Moon",
                                artists: ["Nick Drake"],
                                year: 1972,
                              },
                              {
                                kind: "album",
                                browseId: "MPREb_brynter",
                                title: "Bryter Layter",
                                artists: ["Nick Drake"],
                                year: 1971,
                              },
                            ],
                          }
                        : method === "related"
                          ? {
                              id,
                              result: {
                                songs: [
                                  {
                                    ...ytSongNamed("mayyounever", "May You Never"),
                                    artists: ["John Martyn"],
                                  },
                                ],
                                artists: [{ name: "John Martyn", browseId: "UCjohnmartyn" }],
                              },
                            }
                          : { id, result: null };
      }
      queueMicrotask(() => events.line(JSON.stringify(answer)));
    },
    kill: () => setImmediate(events.exit),
  });
  return { layer: kotlinLayer({ spawn }), reads, yt, downloads, state };
};

/** An empty download journal, as the JVM answers it. */
const downloadAnswers: Readonly<Record<string, unknown>> = {
  "downloads.changes": { revision: 0, jobs: [], ids: null },
  "downloads.refreshPolicy": 1,
  "soulseek.session": { status: "off", username: null },
};

/** A build with no sync service: Settings has no Sign In and nothing goes out. */
const noAccount = (): WaveAccountService =>
  createWaveAccount({
    store: sessionStore({
      box: keyring,
      file: "session.bin",
      files: { read: () => undefined, write: () => {}, remove: () => {} },
      platform: process.platform,
    }),
    syncUrl: null,
    signInWithBrowser: () => Promise.reject(new Error("no sign-in")),
    fetch: () => Promise.reject(new Error("no network")),
    online: () => false,
  });

const connect = (
  file: string,
  isTrusted = (event: unknown) => event === trusted,
  account: { readonly service: WaveAccountService; readonly clock?: SyncClock } = {
    service: noAccount(),
  },
) => {
  const audio = audioInMemory();
  const jvm = jvmInMemory();
  /** What the M3U picker answers. */
  const copied: string[] = [];
  const picked = { playlists: [] as string[] };
  /** How the browser's YouTube sign-in ends. */
  const browser = { outcome: { kind: "noBrowser" } as YtBrowserOutcome };
  const ytSessions = createYtSessions(
    ytSessionStore({
      box: { ...keyring, getSelectedStorageBackend: () => "gnome_libsecret" },
      file: "yt-session.bin",
      files: { read: () => undefined, write: () => {}, remove: () => {} },
      platform: process.platform,
    }),
  );
  const library = desktopLibraryLayer({
    musicFolder: join(dirname(file), "Music"),
    platform: process.platform,
    pickFolder: async () => undefined,
  }).pipe(
    Layer.provideMerge(
      Layer.mergeAll(audio.layer, ytMusicLayer()).pipe(
        Layer.provideMerge(Layer.mergeAll(libraryLayer(file), jvm.layer)),
      ),
    ),
  );
  const downloads = downloadsLayer({
    catalogue: catalogueOf("en", "desktop"),
    platform: process.platform,
    musicFolder: join(dirname(file), "Music"),
    pickFolder: async () => undefined,
    online: () => true,
    events: () => () => {},
    fetch: () => Promise.reject(new Error("no network")),
  }).pipe(Layer.provideMerge(library));
  const languages: LanguageView[] = [];
  const runtime = ManagedRuntime.make(
    accountLayer({
      account: account.service,
      languageChanged: (view) => languages.push(view),
      focused: () => true,
      ...(account.clock === undefined ? {} : { clock: account.clock }),
    }).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          desktopLinksLayer({
            online: () => true,
            writeClipboard: (text) => {
              copied.push(text);
            },
          }),
          ytAccountLayer({
            sessions: ytSessions,
            online: () => true,
            startSignIn: () => ({ outcome: Promise.resolve(browser.outcome), cancel: () => {} }),
          }),
          spotifyImportLayer({ fetch: () => Promise.reject(new Error("no network")) }).pipe(
            Layer.provideMerge(
              spotifyAccountLayer({
                clientId: null,
                store: {
                  keyringMissing: () => true,
                  load: () => null,
                  save: () => {},
                  clear: () => {},
                },
                fetch: () => Promise.reject(new Error("no network")),
                online: () => true,
                openExternal: async () => {},
                page: () => ({ title: "", message: "" }),
              }),
            ),
          ),
        ).pipe(
          Layer.provideMerge(
            ytFeaturesLayer({ online: () => true }).pipe(
              Layer.provideMerge(
                desktopPlaylistsLayer({
                  platform: process.platform,
                  imageFolder: join(dirname(file), "playlist-images"),
                  codec: { original: () => undefined, squares: () => [] },
                  pickImage: async () => undefined,
                  pickPlaylists: async () => picked.playlists,
                }).pipe(
                  Layer.provideMerge(
                    Layer.mergeAll(
                      playbackLayer,
                      lyricsLayer({ fetch: () => Promise.reject(new Error("no network")) }),
                    ).pipe(Layer.provideMerge(downloads)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      withHomeFollow({
        request: account.service.request,
        configured: true,
        signedIn: () => account.service.session().status === "signedIn",
        online: () => true,
        country: () => "BR",
        fetch: () => Promise.reject(new Error("no network")),
      }),
    ),
  );
  const handlers = new Map<string, IpcHandler>();
  registerBridge(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    runtime,
    isTrusted,
  );
  const exposed = new Map<string, unknown>();
  const sent: string[] = [];
  exposeBridge(
    { exposeInMainWorld: (key, api) => exposed.set(key, api) },
    {
      invoke: async (channel, ...args) => {
        sent.push(channel);
        const handler = handlers.get(channel);
        if (handler === undefined) throw new Error(`No handler for ${channel}`);
        return handler(trusted, ...args);
      },
    },
  );
  return {
    runtime,
    handlers,
    exposed,
    sent,
    engineCalls: audio.engineCalls,
    gains: audio.gains,
    measured: audio.measured,
    broken: audio.broken,
    reads: jvm.reads,
    yt: jvm.yt,
    downloads: jvm.downloads,
    jvm: jvm.state,
    picked,
    copied,
    languages,
    browser,
  };
};

const withFile = async (run: (file: string) => Promise<void>): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-bridge-"));
  try {
    await run(join(folder, "wave.db"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

/** Every callable path in an exposed object, such as `library.counts`. */
const callPaths = (value: unknown, path = ""): string[] =>
  typeof value === "function"
    ? [path]
    : typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, inner]) =>
          callPaths(inner, path === "" ? key : `${path}.${key}`),
        )
      : [`${path} (not a call)`];

test("the window reads the Library's counts through the bridge", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    await runtime.runPromise(
      Effect.gen(function* () {
        addTrack((yield* Database) as unknown as TestDatabase, { title: "Pink Moon" });
      }),
    );
    const wave = exposed.get("wave") as WaveBridge;
    assert.equal((await wave.library.counts()).songs, 1);
    await runtime.dispose();
  });
});

test("Library browsing pages albums and their ordered songs through the bridge", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon", trackNumber: 3 });
          addTrack(db, {
            title: "Pink Moon",
            artist: "Nick Drake",
            album: "Pink Moon",
            trackNumber: 1,
          });
          addTrack(db, { title: "Bonus", artist: "Nick Drake", album: "Pink Moon" });
        }),
      );
      const wave = exposed.get("wave") as WaveBridge;
      const albums = await wave.library.browse({ kind: "albums" }, 0, 1);
      assert.equal(albums.total, 1);
      assert.equal(albums.items[0]?.title, "Pink Moon");
      const songs = await wave.library.browse({ kind: "album", id: albums.items[0]!.id }, 0, 1);
      assert.equal(songs.total, 3);
      assert.equal(songs.items[0]?.title, "Pink Moon");
      assert.equal(songs.items[0]?.trackNumber, 1);
      const rest = await wave.library.browse({ kind: "album", id: albums.items[0]!.id }, 1, 1);
      assert.equal(rest.items[0]?.title, "Road");
      await assert.rejects(wave.library.browse({ kind: "songs" }, 0, 201), /Refused/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Library browsing finds favorites, individual artists, genres, playlists and letters", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const id = addTrack(db, { title: "Road", artist: "Nick Drake", genre: "Folk" });
          addTrack(db, { title: "Another song", artist: "Nick Drake" });
          star(db, id, 1000);
          createPlaylist(db, "Evening", [{ source: "library", trackId: id }], 1000);
        }),
      );
      const wave = exposed.get("wave") as WaveBridge;
      assert.equal(
        (await wave.library.browse({ kind: "favorites" }, 0, 10)).items[0]?.title,
        "Road",
      );
      const artists = await wave.library.browse({ kind: "artists" }, 0, 10);
      assert.equal(artists.items[0]?.title, "Nick Drake");
      const artist = await wave.library.browse({ kind: "artist", id: artists.items[0]!.id }, 0, 10);
      assert.equal(artist.items[0]?.artist, "");
      assert.equal((await wave.library.browse({ kind: "genres" }, 0, 10)).items[0]?.title, "Folk");
      const playlists = await wave.library.browse({ kind: "playlists" }, 0, 10);
      assert.equal(playlists.items[0]?.title, "Evening");
      assert.equal(
        (await wave.library.browse({ kind: "playlist", id: playlists.items[0]!.id }, 0, 1)).items[0]
          ?.title,
        "Road",
      );
      assert.equal(await wave.library.letter({ kind: "songs" }, "R"), 1);
      const browse = (scope: unknown) =>
        (wave.library.browse as (s: unknown, o: number, l: number) => Promise<unknown>)(
          scope,
          0,
          10,
        );
      await assert.rejects(browse({ kind: "album", id: -1 }), /Refused/);
      await assert.rejects(browse({ kind: "injected" }), /Refused/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Appearance defaults to system, survives reopening and rejects unknown modes", async () => {
  await withFile(async (file) => {
    const first = connect(file);
    try {
      const wave = first.exposed.get("wave") as WaveBridge;
      assert.equal(await wave.settings.appearance(), "system");
      await wave.settings.setAppearance("dark");
      assert.equal(await wave.settings.appearance(), "dark");
      const handler = first.handlers.get("settings.setAppearance")!;
      await assert.rejects(handler(trusted, "unknown"), /Refused/);
    } finally {
      await first.runtime.dispose();
    }
    const second = connect(file);
    try {
      assert.equal(await (second.exposed.get("wave") as WaveBridge).settings.appearance(), "dark");
    } finally {
      await second.runtime.dispose();
    }
  });
});

test("the window reads scan progress and paged songs and refuses invalid page sizes", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      assert.ok(["idle", "scanning", "done"].includes((await wave.library.scanStatus()).status));
      assert.equal((await wave.library.songs(0, 10)).total, 0);
      await assert.rejects(wave.library.songs(0, 10000), /Refused/);
      await assert.rejects(wave.library.songs(-1, 10), /Refused/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a paused song cannot resume or reload from an unavailable folder", async () => {
  await withFile(async (file) => {
    const music = join(dirname(file), "Music");
    mkdirSync(music);
    const song = join(music, "One.flac");
    writeFileSync(song, "music");
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const library = await runtime.runPromise(DesktopLibrary);
      await library.refresh();
      const indexedPath = library.songs(0, 10).items[0]!.path!;
      await wave.player.load(song);
      rmSync(music, { recursive: true });
      await library.refresh();
      await assert.rejects(wave.player.play(), /folder-unavailable/);
      await assert.rejects(wave.player.load(indexedPath), /folder-unavailable/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("the window gets only the typed calls, never a generic IPC send", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers, sent } = connect(file);
    assert.deepEqual([...exposed.keys()], ["wave"]);
    const paths = callPaths(exposed.get("wave"));
    assert.deepEqual(paths, [...BRIDGE_CALLS]);
    for (const generic of [
      "send",
      "sendSync",
      "invoke",
      "on",
      "once",
      "postMessage",
      "ipcRenderer",
    ])
      assert.ok(!paths.some((path) => path.split(".").includes(generic)), generic);
    assert.deepEqual([...handlers.keys()], [...BRIDGE_CALLS]);
    await (exposed.get("wave") as WaveBridge).library.counts();
    assert.deepEqual(sent, ["library.counts"]);
    await runtime.dispose();
  });
});

test("main refuses a call from a frame other than Wave's window", async () => {
  await withFile(async (file) => {
    const { runtime, handlers } = connect(file);
    const counts = handlers.get("library.counts");
    assert.ok(counts !== undefined);
    await assert.rejects(async () => counts({ senderFrame: "an embedded page" }), /untrusted/i);
    await runtime.dispose();
  });
});

test("the Spotify account bridge refuses extra arguments and exposes no authorized request call", async () => {
  await withFile(async (file) => {
    const { runtime, handlers, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      assert.equal((await wave.spotifyAccount.view()).configured, false);
      assert.equal("request" in wave.spotifyAccount, false);
      const photo = handlers.get("spotifyAccount.photo");
      assert.ok(photo);
      await assert.rejects(async () => photo(trusted, "https://elsewhere.test/image"), /Refused/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("From Spotify's bridge checks what the window sends and answers without the account", async () => {
  await withFile(async (file) => {
    const { runtime, handlers, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      assert.deepEqual(Object.keys(wave.spotifyImport).sort(), [
        "artwork",
        "cancel",
        "library",
        "run",
      ]);
      // This build names no Spotify client, so there is nothing to read.
      const library = await wave.spotifyImport.library(false);
      assert.equal(library.status, "failed");
      assert.equal(library.status === "failed" && library.action, null);
      const call = (name: string, ...args: unknown[]) => handlers.get(name)!(trusted, ...args);
      await assert.rejects(call("spotifyImport.library", "yes"), /Refused/);
      await assert.rejects(call("spotifyImport.library", false, 1), /Refused/);
      await assert.rejects(call("spotifyImport.run", [], false), /Refused/);
      await assert.rejects(call("spotifyImport.run", ["PLnotspotify"], false), /Refused/);
      await assert.rejects(
        call("spotifyImport.run", ["spotify:collection", "spotify:collection"], false),
        /Refused/,
      );
      await assert.rejects(call("spotifyImport.run", ["spotify:collection"], "yes"), /Refused/);
      await assert.rejects(call("spotifyImport.artwork", "https://i.scdn.co/image/a"), /Refused/);
      await assert.rejects(call("spotifyImport.cancel", 1), /Refused/);
      // Nothing was listed, so Import has nothing to name; the window learns no more than that.
      await assert.rejects(
        call("spotifyImport.run", ["spotify:collection"], false),
        /^Error: Spotify import failed$/,
      );
      assert.equal(await wave.spotifyImport.artwork("spotify:collection"), null);
    } finally {
      await runtime.dispose();
    }
  });
});

const song = join(tmpdir(), "Pink Moon.flac");

test("the window plays, pauses and seeks a song through the bridge", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, engineCalls } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    assert.deepEqual(await wave.player.load(song), {
      state: "paused",
      positionMs: 0,
      durationMs: 1_000,
    });
    assert.equal((await wave.player.play()).state, "playing");
    assert.equal((await wave.player.seek(400)).positionMs, 400);
    assert.equal((await wave.player.pause()).state, "paused");
    assert.deepEqual(await wave.player.status(), {
      state: "paused",
      positionMs: 400,
      durationMs: 1_000,
    });
    // Playback sets the saved volume and settings as it starts; the song is what this test plays.
    assert.deepEqual(
      engineCalls.filter((c) => !c.startsWith("volume") && !c.startsWith("settings")),
      [`load ${song}`],
    );
    await runtime.dispose();
  });
});

test("main refuses a player call whose arguments aren't a song and a time", async () => {
  await withFile(async (file) => {
    const { runtime, handlers, engineCalls } = connect(file);
    const call = (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      assert.ok(handler !== undefined, channel);
      return handler(trusted, ...args);
    };
    for (const path of [
      "music/a.flac",
      join(tmpdir(), "notes.txt"),
      join(tmpdir(), "no-extension"),
      42,
      undefined,
    ])
      await assert.rejects(call("player.load", path), /refused/i, String(path));
    for (const positionMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, "400", undefined])
      await assert.rejects(call("player.seek", positionMs), /refused/i, String(positionMs));
    assert.deepEqual(
      engineCalls.filter((c) => !c.startsWith("volume") && !c.startsWith("settings")),
      [],
    );
    await runtime.dispose();
  });
});

test("an engine failure reaches the window with its code", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    await assert.rejects(wave.player.play(), /\[nothing-loaded\] no song is loaded/);
    await runtime.dispose();
  });
});

test("the window reads a song's tags through the JVM", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, reads } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    assert.deepEqual(await wave.tags.read(song), tagsTitled("Pink Moon.flac"));
    assert.deepEqual(reads, [song]);
    await assert.rejects(
      wave.tags.read(join(tmpdir(), "unreadable.mp3")),
      /\[ERR_UNEXPECTED\] FileNotFoundException/,
    );
    await runtime.dispose();
  });
});

test("main refuses to read tags from anything but an audio file's absolute path", async () => {
  await withFile(async (file) => {
    const { runtime, handlers, reads } = connect(file);
    const read = handlers.get("tags.read");
    assert.ok(read !== undefined);
    for (const path of ["music/a.flac", join(tmpdir(), "notes.txt"), 42, undefined])
      await assert.rejects(read(trusted, path), /refused/i, String(path));
    assert.deepEqual(reads, []);
    await runtime.dispose();
  });
});

test("the window plays a list from a row, skips, stars and sets the volume through the bridge", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, engineCalls } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          for (const [n, title] of ["Parasite", "Pink Moon", "Road"].entries())
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon", trackNumber: n + 1 });
        }),
      );
      const album = (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!;
      await wave.playback.start({ kind: "album", id: album.id }, 1);
      let view = await wave.playback.view();
      assert.equal(view.current?.title, "Pink Moon");
      assert.equal(view.status.state, "playing");
      assert.equal(view.length, 3);
      assert.equal(view.index, 1);
      assert.equal(view.undoOffer, null, "nothing was playing before");
      assert.ok(
        engineCalls.includes("preload /Music/Pink Moon/Road.mp3"),
        "the next song is lined up",
      );
      await wave.playback.command({ type: "next" });
      await wave.playback.favorite();
      view = await wave.playback.view();
      assert.equal(view.current?.title, "Road");
      assert.equal(view.current?.favorite, true);
      await wave.playback.start({ kind: "songs" }, 0);
      assert.notEqual((await wave.playback.view()).undoOffer, null, "a new queue offers Undo");
      await wave.playback.undo();
      assert.equal((await wave.playback.view()).current?.title, "Road");
      await wave.playback.volume(0.25, true);
      view = await wave.playback.view();
      assert.equal(view.volume, 0.25);
      assert.equal(view.muted, true);
      assert.equal(engineCalls.at(-1), "volume 0");
      const queue = await wave.playback.queue(0, 10);
      assert.deepEqual(
        queue.items.map((row) => [row.title, row.history, row.current]),
        [
          ["Parasite", true, false],
          ["Pink Moon", true, false],
          ["Road", false, true],
        ],
      );
    } finally {
      await runtime.dispose();
    }
  });
});

/** Runs [check] over a bridge whose Library is the album Pink Moon's three songs. */
const withAlbum = (
  check: (
    wave: WaveBridge,
    album: { readonly id: number },
    bridge: ReturnType<typeof connect>,
  ) => Promise<void>,
) =>
  withFile(async (file) => {
    const bridge = connect(file);
    const wave = bridge.exposed.get("wave") as WaveBridge;
    try {
      await bridge.runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          for (const [n, title] of ["Parasite", "Pink Moon", "Road"].entries())
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon", trackNumber: n + 1 });
        }),
      );
      await check(wave, (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!, bridge);
    } finally {
      await bridge.runtime.dispose();
    }
  });

test("a queue row says its place, so a song the Library lost leaves the rows after it right", async () => {
  await withAlbum(async (wave, album, { runtime }) => {
    await wave.playback.start({ kind: "album", id: album.id }, 0);
    await runtime.runPromise(
      Effect.gen(function* () {
        const db = yield* Database;
        db.run(sql`PRAGMA foreign_keys=OFF`);
        db.run(sql`DELETE FROM tracks WHERE title='Pink Moon'`);
      }),
    );
    const queue = await wave.playback.queue(0, 10);
    assert.equal(queue.total, 3);
    assert.deepEqual(
      queue.items.map((row) => [row.at, row.title]),
      [
        [0, "Parasite"],
        [2, "Road"],
      ],
    );
    assert.deepEqual(
      (await wave.playback.queue(2, 10)).items.map((row) => [row.at, row.title]),
      [[2, "Road"]],
    );
  });
});

test("Previous pressed while Next still runs goes back to the song before", async () => {
  await withAlbum(async (wave, album) => {
    await wave.playback.start({ kind: "album", id: album.id }, 0);
    await wave.playback.seek(60_000);
    await Promise.all([
      wave.playback.command({ type: "next" }),
      wave.playback.command({ type: "previous" }),
    ]);
    assert.equal((await wave.playback.view()).current?.title, "Parasite");
  });
});

test("a song that won't open still leaves its new queue showing, stopped, with Undo offered", async () => {
  await withAlbum(async (wave, album, { broken }) => {
    await wave.playback.start({ kind: "album", id: album.id }, 0);
    broken.add("Road.mp3");
    await assert.rejects(wave.playback.start({ kind: "songs" }, 2), /can't open/);
    const view = await wave.playback.view();
    assert.equal(view.current?.title, "Road");
    assert.equal(view.status.state, "idle");
    assert.notEqual(view.undoOffer, null, "the queue it replaced can come back");
    await wave.playback.undo();
    assert.equal((await wave.playback.view()).current?.title, "Parasite");
  });
});

test("the window sets a sleep timer, End of track holds the next song back, and cancelling lets it go", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, engineCalls, handlers } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          for (const [n, title] of ["Parasite", "Pink Moon", "Road"].entries())
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon", trackNumber: n + 1 });
        }),
      );
      const album = (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!;
      await wave.playback.start({ kind: "album", id: album.id }, 0);
      const before = Date.now();
      const timer = await wave.playback.setSleepTimer({ type: "minutes", minutes: 30 });
      assert.equal(timer?.type, "deadline");
      const endsAt = timer?.type === "deadline" ? timer.endsAt : 0;
      assert.ok(endsAt >= before + 30 * 60_000 && endsAt <= Date.now() + 30 * 60_000);
      assert.deepEqual((await wave.playback.view()).sleepTimer, timer);

      await wave.playback.setSleepTimer({ type: "endOfTrack" });
      assert.deepEqual((await wave.playback.view()).sleepTimer, { type: "endOfTrack" });
      const held = engineCalls.length;
      await wave.playback.command({ type: "next" });
      assert.ok(
        !engineCalls.slice(held).includes("preload /Music/Pink Moon/Road.mp3"),
        "nothing is lined up after the song that ends the timer",
      );
      assert.equal(await wave.playback.setSleepTimer(null), null);
      assert.equal((await wave.playback.view()).sleepTimer, null);
      assert.ok(engineCalls.slice(held).includes("preload /Music/Pink Moon/Road.mp3"));

      for (const bad of [
        { type: "minutes", minutes: 0 },
        { type: "minutes", minutes: 721 },
        { type: "minutes", minutes: 1.5 },
        { type: "never" },
        "endOfTrack",
      ])
        await assert.rejects(call("playback.setSleepTimer", bad), /refused/i);
    } finally {
      await runtime.dispose();
    }
  });
});

test("the window reads a song's lyrics from its file, and a bad track id is refused", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      const id = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          return addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
        }),
      );
      assert.deepEqual(await wave.lyrics.song(String(id)), {
        kind: "synced",
        lines: [{ timeMs: 1000, text: "Road.mp3" }],
      });
      for (const bad of [42, "", "1".repeat(201), null])
        await assert.rejects(call("lyrics.song", bad), /refused/i);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a song plays at its Normalize Volume gain, and songs with no value are measured", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, gains, measured } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, { title: "Parasite", album: "Pink Moon", trackNumber: 1, addedAt: 1 });
        }),
      );
      await wave.playback.start({ kind: "songs" }, 0);
      // No tags, no measurement and too few songs for a median: Core's typical gain.
      assert.deepEqual(gains, ["Parasite.mp3 -5"]);
      for (let n = 0; n < 50 && measured.length === 0; n++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(measured, ["/Music/Pink Moon/Parasite.mp3"]);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Settings › Playback is kept for the account and reaches the engine at once", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers, engineCalls } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      assert.deepEqual(await wave.settings.playback(), {
        crossfadeSeconds: 0,
        normalizeVolume: true,
        bufferMinutes: 2,
      });
      assert.ok(engineCalls.includes("settings crossfade 0"), "the engine starts with them");
      assert.ok(engineCalls.includes("settings normalize true"));
      const after = await wave.settings.setPlayback({
        crossfadeSeconds: 4,
        normalizeVolume: false,
      });
      assert.deepEqual(after, { crossfadeSeconds: 4, normalizeVolume: false, bufferMinutes: 2 });
      assert.deepEqual(engineCalls.slice(-2), ["settings crossfade 4", "settings normalize false"]);
      await wave.settings.setPlayback({ bufferMinutes: 15 });
      assert.deepEqual(await wave.settings.playback(), {
        crossfadeSeconds: 4,
        normalizeVolume: false,
        bufferMinutes: 15,
      });

      for (const change of [
        { crossfadeSeconds: 16 },
        { crossfadeSeconds: Number.NaN },
        { normalizeVolume: "off" },
        { bufferMinutes: 3 },
        { volume: 1 },
        null,
        "fast",
      ])
        await assert.rejects(
          call("settings.setPlayback", change),
          /refused/i,
          JSON.stringify(change),
        );
    } finally {
      await runtime.dispose();
    }
  });
});

test("main refuses playback calls with a bad scope, row, command, time or volume", async () => {
  await withFile(async (file) => {
    const { runtime, handlers, engineCalls } = connect(file);
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      await assert.rejects(call("playback.start", { kind: "albums" }, 0), /refused/i);
      await assert.rejects(call("playback.start", { kind: "songs" }, -1), /refused/i);
      await assert.rejects(call("playback.start", { kind: "songs" }, 0, "yes"), /refused/i);
      await assert.rejects(call("playback.command", { type: "clear" }), /refused/i);
      await assert.rejects(call("playback.command", { type: "jumpTo", key: "x" }), /refused/i);
      await assert.rejects(call("playback.seek", -5), /refused/i);
      await assert.rejects(call("playback.volume", 2, false), /refused/i);
      await assert.rejects(call("playback.volume", 0.5, "no"), /refused/i);
      await assert.rejects(call("playback.queue", 0, 500), /refused/i);
      assert.deepEqual(
        engineCalls.filter((c) => !c.startsWith("volume") && !c.startsWith("settings")),
        [],
      );
    } finally {
      await runtime.dispose();
    }
  });
});

test("Search online is kept on this computer, starts as Only on demand and takes no other choice", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      assert.equal(await wave.settings.searchOnline(), "onDemand");
      await wave.settings.setSearchOnline("always");
      assert.equal(await wave.settings.searchOnline(), "always");
      await assert.rejects(
        handlers.get("settings.setSearchOnline")!(trusted, "sometimes"),
        /refused/i,
      );
      assert.equal(await wave.settings.searchOnline(), "always");
      await assert.rejects(handlers.get("settings.setSearchOnline")!(trusted, "wifi"), /refused/i);
      await wave.settings.setSearchOnline("onDemand");
      assert.equal(await wave.settings.searchOnline(), "onDemand");
    } finally {
      await runtime.dispose();
    }
  });
});

test("a YouTube Music song found in Search plays alone and starts a Magic Queue", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      await wave.yt.search("pink moon");
      await wave.magicQueue.startStreamed("bcdefghijkl");
      assert.equal((await wave.playback.view()).current?.videoId, "bcdefghijkl");
      const queue = await wave.playback.queue(0, 10);
      assert.ok(
        !queue.items.some((row) => row.videoId === "abcdefghijk"),
        "the other search result isn't queued",
      );
      assert.equal((await wave.magicQueue.view()).title, "Road");
    } finally {
      await runtime.dispose();
    }
  });
});

test("a Library song clicked in Search starts a faithful Magic Queue, and plays alone with YT Music off", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      const db = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          for (const title of ["Pink Moon", "Pink Road"])
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon", durationMs: 124_000 });
          return db;
        }),
      );
      const scope = { kind: "search", query: "pink" } as const;
      const tapped = (await wave.library.browse(scope, 0, 10)).items[1]!;
      assert.deepEqual(await wave.playback.start(scope, 1), {
        kind: "playing",
        streamed: 0,
        leftOut: 0,
      });
      assert.equal((await wave.playback.view()).current?.title, tapped.title);
      assert.equal((await wave.magicQueue.view()).title, tapped.title);
      const session = JSON.parse(preference(db, "playback.magicQueue")!) as { faithful?: boolean };
      assert.equal(session.faithful, true);
      await until(async () => (await wave.playback.view()).length > 1);
      const queue = await wave.playback.queue(0, 20);
      assert.equal(queue.items[0]!.title, tapped.title, "the Magic Queue goes on from the song");

      await wave.settings.setYtMusic(false);
      await wave.playback.start(scope, 0);
      assert.equal((await wave.playback.view()).length, 1, "alone, in a queue of one");
      assert.equal((await wave.magicQueue.view()).title, null);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Search finds YouTube Music songs and one plays from the results as a new queue", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, engineCalls, yt } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      assert.equal(await wave.settings.ytMusic(), true, "YT Music is on by default");
      const found = await wave.yt.search("pink moon");
      assert.equal(found.status, "ok");
      assert.deepEqual(
        found.songs.items.map((row) => [row.videoId, row.title, row.artist]),
        [
          ["abcdefghijk", "Pink Moon", "Nick Drake"],
          ["bcdefghijkl", "Road", "Nick Drake"],
        ],
      );
      await wave.playback.startYt(["abcdefghijk", "bcdefghijkl"], 1);
      const view = await wave.playback.view();
      assert.equal(view.current?.videoId, "bcdefghijkl");
      assert.equal(view.current?.artworkUrl, "https://lh3.googleusercontent.com/cover=w120-h120");
      assert.ok(engineCalls.includes("load yt:bcdefghijkl"), engineCalls.join(", "));
      const queue = await wave.playback.queue(0, 10);
      assert.deepEqual(
        queue.items.map((row) => [row.videoId, row.current]),
        [
          ["abcdefghijk", false],
          ["bcdefghijkl", true],
        ],
      );
      const kept = await runtime.runPromise(
        Effect.map(Database, (db) => preference(db, "playback.ytTracks")),
      );
      assert.deepEqual(
        (JSON.parse(kept ?? "[]") as { videoId: string }[]).map((song) => song.videoId),
        ["abcdefghijk", "bcdefghijkl"],
        "the queue's YT Music songs are kept for the next launch",
      );
      assert.deepEqual(yt.slice(0, 2), [
        'setYtMusic {"enabled":true}',
        'search {"query":"pink moon"}',
      ]);
      await wave.playback.favorite();
      assert.equal((await wave.playback.view()).current?.favorite, true, "its star waits for it");
      await wave.playback.favorite();
      assert.equal((await wave.playback.view()).current?.favorite, false);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a streamed song's artist name leads to the Library's artist when it has that name", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      await runtime.runPromise(
        Effect.gen(function* () {
          addTrack((yield* Database) as unknown as TestDatabase, {
            title: "Road",
            artist: "Nick Drake",
          });
        }),
      );
      const mine = await wave.streamed.artist("nick drake");
      assert.equal(mine.kind, "library");
      assert.equal(mine.kind === "library" && mine.artist.name, "Nick Drake");
      assert.deepEqual(await wave.streamed.artist("John Martyn"), {
        kind: "yt",
        name: "John Martyn",
      });
      await assert.rejects(handlers.get("streamed.artist")!(trusted, 7));
    } finally {
      await runtime.dispose();
    }
  });
});

test("Discover's Magic Queue row draws from the playlists' YouTube Music entries too", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      await wave.yt.search("pink moon");
      const made = await wave.playlists.create("Evening");
      await wave.streamed.run("bcdefghijkl", "addToPlaylist", made.id);
      const picks = await wave.discover.picks();
      assert.deepEqual(
        picks.items.map((row) => [row.videoId, row.title]),
        [["bcdefghijkl", "Road"]],
      );
      await wave.magicQueue.startStreamed("bcdefghijkl");
      assert.equal((await wave.playback.view()).current?.videoId, "bcdefghijkl");

      await wave.settings.setYtMusic(false);
      assert.deepEqual((await wave.discover.picks()).items, []);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a streamed song has the phone's menu: star, playlist, download, its album and artist", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, downloads, handlers } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      await wave.yt.search("pink moon");
      const menu = await wave.streamed.menu("abcdefghijk");
      assert.equal(menu.title, "Pink Moon");
      assert.deepEqual(
        menu.entries.map((entry) => entry.action),
        [
          "playNext",
          "addToQueue",
          "magicQueue",
          "addToPlaylist",
          "favorite",
          "goToAlbum",
          "goToArtist",
          "share",
          "download",
        ],
      );
      assert.deepEqual(menu.entries[5], { action: "goToAlbum", album: "MPREb_pinkmoon" });
      assert.deepEqual(menu.entries[6], {
        action: "goToArtist",
        artists: { kind: "open", target: { kind: "yt", name: "Nick Drake" } },
      });
      assert.deepEqual(menu.download, { kind: "download" });
      const playing = await wave.streamed.menu("abcdefghijk", true);
      assert.ok(!playing.entries.some((entry) => entry.action === "playNext"));

      // A star means downloaded: it waits as a pending favorite while the file comes.
      assert.deepEqual(await wave.streamed.run("abcdefghijk", "favorite"), {
        kind: "favorite",
        on: true,
        count: 1,
      });
      const pending = () =>
        runtime.runPromise(
          Effect.map(Database, (db) =>
            db.all<{ videoId: string }>(sql`SELECT video_id AS videoId FROM pending_favorites`),
          ),
        );
      assert.deepEqual(await pending(), [{ videoId: "abcdefghijk" }]);
      assert.ok(
        downloads.some((call) => call.includes('"abcdefghijk"')),
        downloads.join(", "),
      );
      const starred = await wave.streamed.menu("abcdefghijk");
      assert.equal(starred.favorite, true);
      assert.ok(starred.entries.some((entry) => entry.action === "unfavorite"));
      await wave.playback.startYt(["abcdefghijk"], 0);
      assert.equal((await wave.playback.view()).current?.favorite, true);
      assert.equal((await wave.playback.queue(0, 10)).items[0]?.favorite, true);
      await wave.streamed.run("abcdefghijk", "unfavorite");
      assert.deepEqual(await pending(), []);
      assert.equal((await wave.streamed.menu("abcdefghijk")).favorite, false);

      // Add to Playlist keeps a YT Music entry, which becomes the Library's song once it's here.
      const made = await wave.playlists.create("Evening");
      assert.deepEqual(await wave.streamed.run("bcdefghijkl", "addToPlaylist", made.id), {
        kind: "playlist",
        name: "Evening",
        added: 1,
        alreadyIn: 0,
      });
      const entries = await runtime.runPromise(
        Effect.map(Database, (db) =>
          db.all<{ ytSong: string | null }>(
            sql`SELECT yt_song AS ytSong FROM playlist_items WHERE playlist_id=${made.id}`,
          ),
        ),
      );
      assert.equal(entries.length, 1);
      assert.match(entries[0]!.ytSong ?? "", /bcdefghijkl/);
      assert.ok(
        downloads.some((call) => call.includes('"bcdefghijkl"')),
        "its download is asked",
      );

      assert.deepEqual(await wave.streamed.run("bcdefghijkl", "playNext"), {
        kind: "queued",
        count: 1,
      });
      assert.deepEqual(
        (await wave.playback.queue(0, 2)).items.map((row) => row.videoId),
        ["abcdefghijk", "bcdefghijkl"],
      );

      // The Library has the song: its menu stars the Library's song.
      const road = await runtime.runPromise(
        Effect.map(Database, (db) => {
          const id = addTrack(db as unknown as TestDatabase, {
            title: "Road",
            artist: "Nick Drake",
            album: "Pink Moon",
            durationMs: 124_000,
          });
          // As a scan keeps it, for finding the Library's song for a streamed one.
          db.run(sql`UPDATE tracks SET match_title=${recordingMatchTitle("Road")} WHERE id=${id}`);
          return id;
        }),
      );
      await wave.streamed.run("bcdefghijkl", "favorite");
      const library = await wave.songs.actions({ scope: { kind: "songs" }, ids: [road] }, "menu");
      assert.ok(library.entries.some((entry) => entry.action === "unfavorite"));

      for (const args of [
        ["not a video", false],
        ["zzzzzzzzzzz", false],
      ])
        await assert.rejects(handlers.get("streamed.menu")!(trusted, ...args));
      await assert.rejects(handlers.get("streamed.run")!(trusted, "abcdefghijk", "delete"));
      await assert.rejects(handlers.get("streamed.run")!(trusted, "abcdefghijk", "addToPlaylist"));
    } finally {
      await runtime.dispose();
    }
  });
});

test("a streamed song added to a playlist goes up to the account", async () => {
  await withFile(async (file) => {
    const app = await desktop();
    const phone = await app.service.signIn();
    const { clock, pass } = fakeClock();
    const { runtime, exposed } = connect(file, undefined, { service: app.open(), clock });
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await wave.account.signIn();
      await wave.yt.search("pink moon");
      const made = await wave.playlists.create("Evening");
      await wave.streamed.run("abcdefghijk", "addToPlaylist", made.id);
      await pass(10_000);
      let entries: readonly unknown[] = [];
      // Asked seldom: the service answers 429 to a client that pulls too often.
      for (let tries = 0; tries < 20 && entries.length === 0; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        entries = (await pullAll(app.service, phone)).playlistEntries;
      }
      assert.equal(entries.length, 1);
      assert.match(JSON.stringify(entries[0]), /abcdefghijk/);
    } finally {
      await runtime.dispose();
    }
  });
});

/** Waits until [ready] holds, as the window's polling does. */
const until = async (ready: () => Promise<boolean>): Promise<void> => {
  for (let tries = 0; tries < 500; tries++) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("never ready");
};

test("a build with no sync service shows no Sign In and no invitation", async () => {
  await withFile(async (file) => {
    mkdirSync(join(dirname(file), "Music"));
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await until(async () => (await wave.library.scanStatus()).status === "done");
      const view = await wave.account.view();
      assert.deepEqual(view.account, { kind: "unavailable" });
      assert.equal(view.invitation, false);
      assert.equal(view.theme, null);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Delete Account from the window deletes the account and leaves Wave signed out", async () => {
  await withFile(async (file) => {
    const app = await desktop();
    const { runtime, exposed } = connect(file, undefined, { service: app.open() });
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await wave.account.signIn();
      assert.equal((await wave.account.view()).account.kind, "account");
      await wave.account.deleteAccount();
      const view = await wave.account.view();
      assert.deepEqual(view.account, { kind: "signedOut", action: "signIn", note: "deleted" });
      assert.equal(view.invitation, false);
      const accounts = await app.service.db.execute("SELECT COUNT(*) AS n FROM accounts");
      assert.equal(Number(accounts.rows[0]?.["n"]), 0);
    } finally {
      await runtime.dispose();
    }
  });
});

test("the invitation to sign in shows once the first scan finished, until it's answered", async () => {
  await withFile(async (file) => {
    mkdirSync(join(dirname(file), "Music"));
    const app = await desktop();
    const first = connect(file, undefined, { service: app.open() });
    const wave = first.exposed.get("wave") as WaveBridge;
    try {
      await until(async () => (await wave.library.scanStatus()).status === "done");
      assert.equal((await wave.account.view()).invitation, true);
      await wave.account.answerInvitation();
      assert.equal((await wave.account.view()).invitation, false);
    } finally {
      await first.runtime.dispose();
    }
    const second = connect(file, undefined, { service: app.open() });
    const reopened = second.exposed.get("wave") as WaveBridge;
    try {
      await until(async () => (await reopened.library.scanStatus()).status === "done");
      assert.equal((await reopened.account.view()).invitation, false, "answered for good");
    } finally {
      await second.runtime.dispose();
    }
  });
});

test("the account's language applies on sign-in and later pulls, and desktop changes sync back", async () => {
  await withFile(async (file) => {
    const app = await desktop();
    const phone = await app.service.signIn();
    const phoneDb = await openTestDatabase();
    const values = new Map<string, string>([["settings.language", "pt-BR"]]);
    const phoneSync = () =>
      syncCycle({
        db: phoneDb,
        splits: creditSplits(),
        account: "ana@example.com",
        transport: {
          request: async (method, path, body) => {
            const response = await app.service.request(method, path, {
              session: phone,
              ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
            });
            return { status: response.status, body: await response.text() };
          },
        },
        preferences: {
          value: (key) => values.get(key) ?? null,
          apply: (key, value) => {
            if (value === null) values.delete(key);
            else values.set(key, value);
          },
        },
        now: Date.now,
        songsChanged: false,
        wait: async () => {},
      });
    stampPreference(phoneDb, "settings.language", Date.now());
    await phoneSync();
    const { clock, pass } = fakeClock();
    const { runtime, exposed, languages } = connect(file, undefined, {
      service: app.open(),
      clock,
    });
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await wave.account.signIn();
      await until(async () => (await wave.settings.language()).language === "pt-BR");
      assert.deepEqual(languages.at(-1), { choice: "pt-BR", language: "pt-BR" });
      await wave.settings.setLanguage("en");
      await pass(10_000);
      await until(async () => {
        await phoneSync();
        return values.get("settings.language") === "en";
      });
      values.set("settings.language", "system");
      stampPreference(phoneDb, "settings.language", Date.now() + 1000);
      await phoneSync();
      await pass(15 * 60_000);
      await until(async () => (await wave.settings.language()).choice === "system");
      assert.deepEqual(languages.at(-1), { choice: "system", language: "en" });
    } finally {
      await runtime.dispose();
    }
  });
});

test("a phone's Settings › Playback reaches the desktop's engine when a sync pulls it", async () => {
  await withFile(async (file) => {
    const app = await desktop();
    const phone = await app.service.signIn();
    const { runtime, exposed, engineCalls } = connect(file, undefined, { service: app.open() });
    const wave = exposed.get("wave") as WaveBridge;
    try {
      // The phone sets a 6 s Crossfade and turns Normalize Volume off, then syncs.
      const phoneDb = await openTestDatabase();
      const values = new Map([
        ["settings.crossfadeSeconds", "6"],
        ["settings.normalizeVolume", "off"],
      ]);
      for (const key of values.keys()) stampPreference(phoneDb, key, Date.now());
      await syncCycle({
        db: phoneDb,
        splits: creditSplits(),
        transport: {
          request: async (method, path, body) => {
            const response = await app.service.request(method, path, {
              session: phone,
              ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
            });
            return { status: response.status, body: await response.text() };
          },
        },
        account: "ana@example.com",
        preferences: { value: (key) => values.get(key) ?? null, apply: () => {} },
        now: Date.now,
        songsChanged: true,
        wait: async () => {},
      });

      assert.equal((await wave.settings.playback()).crossfadeSeconds, 0);
      assert.ok(
        engineCalls.includes("settings crossfade 0"),
        "the engine starts with the defaults",
      );
      await wave.account.signIn();
      await until(async () => (await wave.settings.playback()).crossfadeSeconds === 6);
      assert.deepEqual(await wave.settings.playback(), {
        crossfadeSeconds: 6,
        normalizeVolume: false,
        bufferMinutes: 2,
      });
      await until(async () => engineCalls.includes("settings normalize false"));
      assert.deepEqual(engineCalls.slice(-2), ["settings crossfade 6", "settings normalize false"]);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Search finds YouTube Music artists and albums, and says which the Library has", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, {
            title: "Pink Moon",
            artist: "Nick Drake",
            album: "Pink Moon",
            trackNumber: 1,
            durationMs: 124_000,
          });
        }),
      );
      const found = await wave.yt.search("nick drake");
      assert.equal(found.status, "ok");
      assert.deepEqual(
        found.artists.map((artist) => artist.browseId),
        ["UCnickdrake", "UCtribute"],
      );
      assert.deepEqual(
        found.albums.map((album) => [album.browseId, album.title]),
        [
          ["MPREb_pinkmoon", "Pink Moon"],
          ["MPREb_brynter", "Bryter Layter"],
        ],
      );
      assert.deepEqual(found.inLibrary, {
        songs: ["abcdefghijk"],
        artists: ["UCnickdrake"],
        albums: ["MPREb_pinkmoon"],
      });
      const [row] = found.songs.items;
      assert.deepEqual(row?.artists, ["Nick Drake"], "a row names each artist");
      assert.equal(row?.albumId, "MPREb_pinkmoon", "a row knows its album page");
    } finally {
      await runtime.dispose();
    }
  });
});

test("YT Music turned off hides its results and tells the JVM, and offline says so quietly", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, yt, jvm } = connect(file);
    try {
      const wave = exposed.get("wave") as WaveBridge;
      await wave.settings.setYtMusic(false);
      assert.equal(await wave.settings.ytMusic(), false);
      assert.equal((await wave.yt.search("pink moon")).status, "disabled");
      assert.ok(!yt.some((call) => call.startsWith("search")), "nothing is asked of YouTube");
      assert.ok(yt.includes('setYtMusic {"enabled":false}'));
      await wave.settings.setYtMusic(true);
      jvm.ytError = "ERR_YT_OFFLINE";
      const offline = await wave.yt.search("pink moon");
      assert.equal(offline.status, "offline");
      assert.deepEqual([offline.songs.items, offline.artists, offline.albums], [[], [], []]);
    } finally {
      await runtime.dispose();
    }
  });
});

test("signing in from the window brings the account's playlists and theme, and a star goes up", async () => {
  await withFile(async (file) => {
    const app = await desktop();
    const phone = await app.service.signIn();
    const { clock, pass } = fakeClock();
    const { runtime, exposed } = connect(file, undefined, { service: app.open(), clock });
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, { title: "Pink Moon", artist: "Nick Drake", album: "Pink Moon" });
        }),
      );
      // The phone's Library: a playlist of a song this computer has and one it hasn't.
      const phoneDb = await openTestDatabase();
      const pinkMoon = addTrack(phoneDb, {
        title: "Pink Moon",
        artist: "Nick Drake",
        album: "Pink Moon",
      });
      const road = addTrack(phoneDb, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
      createPlaylist(
        phoneDb,
        "Night",
        [
          { source: "library", trackId: pinkMoon },
          { source: "library", trackId: road },
        ],
        Date.now(),
      );
      stampPreference(phoneDb, "settings.theme", Date.now());
      await syncCycle({
        db: phoneDb,
        splits: creditSplits(),
        transport: {
          request: async (method, path, body) => {
            const response = await app.service.request(method, path, {
              session: phone,
              ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
            });
            return { status: response.status, body: await response.text() };
          },
        },
        account: "ana@example.com",
        preferences: {
          value: (key) => (key === "settings.theme" ? '{"light":"white"}' : null),
          apply: () => {},
        },
        now: Date.now,
        songsChanged: true,
        wait: async () => {},
      });

      const before = (await wave.account.view()).revision;
      await wave.account.signIn();
      assert.equal((await wave.account.view()).account.kind, "account");
      await until(async () => (await wave.account.view()).revision > before);
      await until(
        async () => (await wave.library.browse({ kind: "playlists" }, 0, 10)).total === 1,
      );
      const night = (await wave.library.browse({ kind: "playlists" }, 0, 10)).items[0]!;
      assert.deepEqual(
        (await wave.library.browse({ kind: "playlist", id: night.id }, 0, 10)).items.map((row) => [
          row.title,
          row.path === null,
        ]),
        [
          ["Pink Moon", false],
          ["Road", true],
        ],
      );
      assert.equal((await wave.account.view()).theme, '{"light":"white"}');

      await wave.playback.start({ kind: "songs" }, 0);
      await wave.playback.favorite();
      await pass(10_000);
      await until(async () => (await pullAll(app.service, phone)).favorites.length === 1);

      // A star from a song's menu goes up the same way.
      const roadRow = (await wave.library.browse({ kind: "playlist", id: night.id }, 0, 10))
        .items[1]!;
      await wave.songs.run(
        { scope: { kind: "playlist", id: night.id }, ids: [roadRow.id] },
        "favorite",
      );
      await pass(10_000);
      // Asked seldom: the service answers 429 to a client that pulls too often.
      let favorites = 0;
      for (let tries = 0; tries < 20 && favorites < 2; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        favorites = (await pullAll(app.service, phone)).favorites.length;
      }
      assert.equal(favorites, 2, "the song menu's star went up");
    } finally {
      await runtime.dispose();
    }
  });
});

test("main refuses YT Music calls with bad songs, settings, queries or covers", async () => {
  await withFile(async (file) => {
    const { runtime, handlers } = connect(file);
    try {
      const call = (channel: string, ...args: unknown[]) =>
        handlers.get(channel)!(trusted, ...args);
      await assert.rejects(call("playback.startYt", ["../etc/passwd"], 0), /Refused/);
      await assert.rejects(call("playback.startYt", ["abcdefghijk"], 1), /Refused/);
      await assert.rejects(call("playback.startYt", [], 0), /Refused/);
      await assert.rejects(call("settings.setYtMusic", "off"), /Refused/);
      await assert.rejects(call("yt.search", { query: "a" }), /Refused/);
      await assert.rejects(call("yt.artwork", 7), /Refused/);
      assert.equal(await call("yt.artwork", "file:///C:/Windows/win.ini"), null);
      await assert.rejects(
        call("playback.startYt", ["zzzzzzzzzzz"], 0),
        /yt-unknown/,
        "only songs a search found",
      );
    } finally {
      await runtime.dispose();
    }
  });
});

test("a Magic Queue, an artist page and Discover's row come through the bridge, quietly offline", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers, jvm } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const pinkMoon = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const ids = ["Parasite", "Pink Moon", "Road"].map((title, n) =>
            addTrack(db, {
              title,
              artist: "Nick Drake",
              album: "Pink Moon",
              trackNumber: n + 1,
              durationMs: 124_000,
            }),
          );
          return ids[1]!;
        }),
      );
      // With YT Music on, a song's menu offers Start Magic Queue after Add to Queue.
      const one = { scope: { kind: "songs" }, ids: [pinkMoon] } as const;
      assert.deepEqual(
        (await wave.songs.actions(one, "menu")).entries.slice(0, 3).map((entry) => entry.action),
        ["playNext", "addToQueue", "magicQueue"],
      );
      await wave.settings.setYtMusic(false);
      assert.ok(
        !(await wave.songs.actions(one, "menu")).entries.some((e) => e.action === "magicQueue"),
      );
      await wave.settings.setYtMusic(true);
      // The sleep timer at End of Queue holds the recommendations back until it is turned off.
      await wave.playback.setSleepTimer({ type: "endOfQueue" });
      assert.equal(
        await wave.magicQueue.start({ scope: { kind: "songs" }, ids: [pinkMoon] }),
        true,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal((await wave.playback.view()).length, 1, "the queue plays out");
      await wave.playback.setSleepTimer(null);
      await until(async () => (await wave.playback.view()).length > 1);
      assert.equal((await wave.playback.view()).current?.title, "Pink Moon");
      assert.deepEqual(await wave.magicQueue.view(), { title: "Pink Moon", status: "idle" });
      const queue = await wave.playback.queue(0, 20);
      assert.ok(
        queue.items.some((row) => row.videoId?.startsWith("radio")),
        "the song's radio joins the queue",
      );

      const artist = await wave.yt.artist("UCnickdrake");
      assert.equal(artist.status, "ok");
      assert.equal(artist.page?.name, "Nick Drake");
      assert.deepEqual(
        artist.page?.songs.items.map((row) => row.title),
        ["Pink Moon"],
      );
      assert.deepEqual(
        artist.page?.similar.map((found) => found.name),
        ["John Martyn"],
      );
      assert.equal((await wave.discover.picks()).items.length, 3);

      // Related: a row's + lines it up as the menu's Add to Queue does, a click plays it now.
      const related = await wave.yt.related();
      assert.equal(related.status, "ok");
      assert.deepEqual(
        related.songs.items.map((row) => row.videoId),
        ["mayyounever"],
      );
      await wave.yt.queue("addToQueue", "mayyounever");
      const queued = await wave.playback.queue(0, 100);
      assert.deepEqual(
        queued.items.slice(0, 2).map((row) => row.title),
        ["Pink Moon", "May You Never"],
      );
      await wave.yt.queue("playNow", "mayyounever");
      await until(async () => (await wave.playback.view()).current?.title === "May You Never");

      // Offline, a page says so and nothing else.
      jvm.ytError = "ERR_YT_OFFLINE";
      assert.deepEqual(await wave.yt.artist("UCnickdrake"), { status: "offline", page: null });
      await wave.playback.command({ type: "next" });
      const offline = await wave.yt.related();
      assert.equal(offline.status, "offline");
      assert.equal(offline.songs.total, 0);

      const call = (channel: string, ...args: unknown[]) =>
        handlers.get(channel)!(trusted, ...args);
      await assert.rejects(call("yt.artist", "../etc"), /Refused/);
      await assert.rejects(
        call("magicQueue.start", { scope: { kind: "songs" }, ids: [] }),
        /Refused/,
      );
      await assert.rejects(call("magicQueue.startStreamed", "nope"), /Refused/);
      await assert.rejects(call("discover.playMix", "mix", -1), /Refused/);
      await assert.rejects(call("yt.queue", "shuffle", "mayyounever"), /Refused/);
      await assert.rejects(call("yt.queue", "playNow", "unknownsong"), /yt-unknown/);
      assert.equal(await call("discover.playMix", "gone", 0), false);
      await assert.rejects(
        call("discover.setSettings", { level: 6, faithfulness: 3, popularity: 3 }),
        /Refused/,
      );
      assert.deepEqual(
        await call("discover.setSettings", { level: 5, faithfulness: 1, popularity: 4 }),
        {
          level: 5,
          faithfulness: 1,
          popularity: 4,
        },
      );
      assert.deepEqual(await wave.discover.settings(), {
        level: 5,
        faithfulness: 1,
        popularity: 4,
      });
    } finally {
      await runtime.dispose();
    }
  });
});

test("collection actions queue and copy every song in collection order", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      const { seed, source, destination } = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const seed = addTrack(db, { title: "Seed", album: "Elsewhere" });
          const tracks = ["Zulu", "Alpha"].map((title, index) => ({
            source: "library" as const,
            trackId: addTrack(db, {
              title,
              artist: "Wave",
              album: "Disc",
              genre: "Rock",
              trackNumber: index + 1,
            }),
          }));
          const source = createPlaylist(db, "Source", tracks, 1000).playlistId;
          const destination = createPlaylist(db, "Destination", [], 1000).playlistId;
          return { seed, source, destination };
        }),
      );
      const album = (await wave.library.browse({ kind: "albums" }, 0, 10)).items.find(
        (row) => row.title === "Disc",
      )!;
      const target = { kind: "album", id: album.id } as const;
      const playlist = { kind: "playlist", id: source } as const;
      const titles = async () => (await wave.playback.queue(0, 20)).items.map((row) => row.title);
      const start = () => wave.playback.start({ kind: "search", query: "Seed" }, 0);
      await wave.settings.setYtMusic(false);
      assert.deepEqual(
        (
          await wave.collections.actions(target, { here: "/library", selectable: true })
        ).entries.map((entry) => entry.action),
        ["playNext", "addToQueue", "addToPlaylist", "goToArtist", "fixSongs", "select"],
      );
      assert.equal(
        (await wave.library.browse({ kind: "search", query: "Seed" }, 0, 1)).items[0]?.id,
        seed,
      );
      await start();
      assert.deepEqual(await wave.collections.run(target, "playNext"), {
        kind: "queued",
        count: 2,
      });
      assert.deepEqual(await titles(), ["Seed", "Zulu", "Alpha"]);
      await start();
      assert.deepEqual(await wave.collections.run(playlist, "addToQueue"), {
        kind: "queued",
        count: 2,
      });
      assert.deepEqual(await titles(), ["Seed", "Zulu", "Alpha"]);
      assert.deepEqual(await wave.collections.run(playlist, "addToPlaylist", destination), {
        kind: "playlist",
        name: "Destination",
        added: 2,
        alreadyIn: 0,
      });
      assert.deepEqual(
        (await wave.library.browse({ kind: "playlist", id: destination }, 0, 10)).items.map(
          (row) => row.title,
        ),
        ["Zulu", "Alpha"],
      );
      await wave.settings.setYtMusic(true);
      assert.ok(
        (await wave.collections.actions(playlist)).entries.some(
          (entry) => entry.action === "magicQueue",
        ),
      );
      await assert.rejects(
        call("collections.run", { kind: "songs", id: 1 }, "playNext"),
        /refused/i,
      );
      await assert.rejects(call("collections.run", target, "deletePlaylist"), /refused/i);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a song's menu and the selection bar offer and run the phone's actions through the bridge", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const { ids, playlistId } = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const ids = ["Parasite", "Pink Moon", "Road"].map((title, n) =>
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon", trackNumber: n + 1 }),
          );
          const playlistId = createPlaylist(db, "Evening", [], 1000).playlistId;
          return { ids, playlistId };
        }),
      );
      const songs = { kind: "songs" } as const;
      const album = (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!;
      const menu = await wave.songs.actions({ scope: songs, ids: [ids[0]!] }, "menu");
      assert.equal(menu.title, "Parasite");
      assert.equal(menu.count, 1);
      assert.deepEqual(menu.entries, [
        { action: "playNext" },
        { action: "addToQueue" },
        { action: "magicQueue" },
        { action: "addToPlaylist" },
        { action: "favorite" },
        { action: "goToAlbum", albumId: album.id },
        { action: "goToArtist", artists: { kind: "open", artistId: menu.artists[0]!.id } },
        // It has no lyrics, genre or year to fix yet.
        { action: "fixSong" },
        { action: "share" },
        { action: "select" },
        { action: "removeFromLibrary" },
      ]);
      assert.deepEqual(
        menu.artists.map((artist) => artist.name),
        ["Nick Drake"],
      );
      const onAlbum = await wave.songs.actions(
        { scope: { kind: "album", id: album.id }, ids: [ids[0]!] },
        "selection",
      );
      assert.deepEqual(
        onAlbum.entries.map((entry) => entry.action),
        [
          "playNext",
          "addToQueue",
          "addToPlaylist",
          "favorite",
          "goToArtist",
          "fixSong",
          "removeFromLibrary",
        ],
      );

      // Select All with one song unchecked acts on the others, in list order.
      const rest = { scope: songs, all: true, except: [ids[1]!] } as const;
      assert.equal((await wave.songs.actions(rest, "selection")).count, 2);
      await wave.playback.start(songs, 1);
      assert.deepEqual(await wave.songs.run(rest, "addToQueue"), { kind: "queued", count: 2 });
      assert.deepEqual(
        (await wave.playback.queue(0, 10)).items.map((row) => row.title),
        // Queued songs play after the current one, ahead of the rest of the list, as on the phone.
        ["Parasite", "Pink Moon", "Parasite", "Road", "Road"],
      );
      assert.deepEqual(await wave.songs.run(rest, "favorite"), {
        kind: "favorite",
        on: true,
        count: 2,
      });
      assert.equal((await wave.library.browse({ kind: "favorites" }, 0, 10)).total, 2);
      assert.deepEqual(
        (await wave.songs.actions(rest, "selection")).entries.map((entry) => entry.action),
        [
          "playNext",
          "addToQueue",
          "addToPlaylist",
          "unfavorite",
          "goToAlbum",
          "goToArtist",
          "fixSongs",
          "removeFromLibrary",
        ],
      );
      assert.deepEqual(await wave.songs.run(rest, "addToPlaylist", playlistId), {
        kind: "playlist",
        name: "Evening",
        added: 2,
        alreadyIn: 0,
      });
      assert.deepEqual(await wave.songs.run(rest, "addToPlaylist", playlistId), {
        kind: "playlist",
        name: "Evening",
        added: 0,
        alreadyIn: 2,
      });
      assert.deepEqual(
        await wave.songs.run({ scope: songs, ids: [ids[2]!] }, "removeFromLibrary"),
        {
          kind: "removed",
          count: 1,
        },
      );
      assert.deepEqual(
        (await wave.library.browse(songs, 0, 10)).items.map((row) => row.title),
        ["Parasite", "Pink Moon"],
      );
      assert.deepEqual((await wave.library.exclusions(0, 10)).items, ["/Music/Pink Moon/Road.mp3"]);
    } finally {
      await runtime.dispose();
    }
  });
});

test("main refuses song actions with a bad target, surface, action or playlist", async () => {
  await withFile(async (file) => {
    const { runtime, handlers } = connect(file);
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    const songs = { kind: "songs" };
    try {
      for (const target of [
        undefined,
        { scope: songs },
        { scope: { kind: "albums" }, ids: [1] },
        { scope: songs, ids: [0] },
        { scope: songs, ids: ["1"] },
        { scope: songs, ids: Array.from({ length: 10_001 }, (_, n) => n + 1) },
        { scope: songs, all: false, except: [] },
        { scope: songs, all: true, except: [1.5] },
      ])
        await assert.rejects(call("songs.actions", target, "menu"), /refused/i);
      const one = { scope: songs, ids: [1] };
      await assert.rejects(call("songs.actions", one, "bar"), /refused/i);
      for (const action of ["delete", "select", "goToAlbum", undefined])
        await assert.rejects(call("songs.run", one, action), /refused/i, String(action));
      await assert.rejects(call("songs.run", one, "addToPlaylist"), /refused/i);
      await assert.rejects(call("songs.run", one, "addToPlaylist", -1), /refused/i);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Fix Song stays off when the Wave account turns online lookups off", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    try {
      const id = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          db.run(
            sql`INSERT INTO desktop_synced_preferences (key, value) VALUES ('settings.findLyricsAndGenre', 'off')`,
          );
          return addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
        }),
      );
      const wave = exposed.get("wave") as WaveBridge;
      const target = { scope: { kind: "songs" as const }, ids: [id] };
      const menu = await wave.songs.actions(target, "menu");
      assert.ok(!menu.entries.some((entry) => entry.action === "fixSong"));
      await assert.rejects(wave.songs.run(target, "fixSong"), /lookups-off/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a YT Music song a search found is downloaded through the JVM's journal", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, downloads } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await wave.yt.search("pink moon");
      await wave.downloads.yt(["abcdefghijk"]);
      const asked = downloads.find((line) => line.startsWith("downloads.enqueueAll "));
      assert.ok(asked?.includes('"videoId":"abcdefghijk"'));
      assert.ok(asked?.includes('"source":"youtube"'));
      const view = await wave.downloads.view();
      assert.equal(view.online, true);
      assert.deepEqual(view.missing, { count: 0, line: null, actions: [], notFound: null });
      assert.deepEqual(await wave.downloads.rows(0, 50), { items: [], offset: 0, total: 0 });
      assert.equal(await wave.downloads.list({ kind: "album", id: 999 }), null);
      assert.equal(await wave.downloads.bestQuality(), false);
    } finally {
      await runtime.dispose();
    }
  });
});

test("New Playlist, Remove from Playlist and an M3U import show in the playlists list at once", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, picked } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const ids = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          return ["Parasite", "Road"].map((title) =>
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon" }),
          );
        }),
      );
      const sidebar = async () =>
        (await wave.library.browse({ kind: "playlists" }, 0, 50)).items.map((row) => row.title);
      const songs = { kind: "songs" } as const;
      const before = (await wave.playback.view()).revision;
      const made = await wave.playlists.create(await wave.playlists.newName(), {
        scope: songs,
        ids,
      });
      assert.deepEqual(made, { id: made.id, name: "New Playlist", added: 2 });
      assert.deepEqual(await sidebar(), ["New Playlist"]);
      assert.ok((await wave.playback.view()).revision > before, "the window hears of it");
      await wave.playlists.rename(made.id, "Evening");
      assert.deepEqual(await sidebar(), ["Evening"]);

      const onPage = { scope: { kind: "playlist", id: made.id }, ids: [ids[0]!] } as const;
      assert.ok(
        (await wave.songs.actions(onPage, "menu")).entries.some(
          (entry) => entry.action === "removeFromPlaylist",
        ),
      );
      assert.deepEqual(await wave.songs.run(onPage, "removeFromPlaylist"), {
        kind: "playlistRemoved",
        count: 1,
      });
      assert.equal((await wave.playlists.graveyard(made.id, 0, 10)).items[0]?.title, "Parasite");
      await wave.playlists.undoRemove();
      assert.equal((await wave.library.browse(onPage.scope, 0, 10)).total, 2);

      // Another player's playlist beside the music, naming it by a relative path.
      const road = join(dirname(file), "Music", "Road.mp3");
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* Database;
          db.run(
            sql`UPDATE tracks SET path=${scanPath(road, process.platform)} WHERE id=${ids[1]!}`,
          );
        }),
      );
      const m3u = join(dirname(file), "Music", "Night.m3u8");
      mkdirSync(dirname(m3u), { recursive: true });
      writeFileSync(m3u, "#EXTM3U\nRoad.mp3\nGone.mp3\n");
      picked.playlists = [m3u];
      assert.deepEqual(await wave.playlists.chooseImport(), {
        files: [{ name: "Night.m3u8", clash: null }],
      });
      const result = await wave.playlists.runImport(["keepBoth"]);
      assert.deepEqual(result.outcomes, [
        { kind: "imported", name: "Night", songs: 1, missing: ["Gone.mp3"], replaced: false },
      ]);
      assert.deepEqual(await sidebar(), ["Evening", "Night"]);

      await wave.playlists.delete(made.id);
      assert.ok(!(await sidebar()).includes("Evening"));
    } finally {
      await runtime.dispose();
    }
  });
});

test("main refuses download calls with bad songs, actions, ids or pages", async () => {
  await withFile(async (file) => {
    const { runtime, handlers } = connect(file);
    try {
      const call = (channel: string, ...args: unknown[]) =>
        handlers.get(channel)!(trusted, ...args);
      await assert.rejects(call("downloads.yt", ["../etc/passwd"]), /Refused/);
      await assert.rejects(call("downloads.yt", []), /Refused/);
      await assert.rejects(call("downloads.missing", [0]), /Refused/);
      await assert.rejects(call("downloads.missing", "1"), /Refused/);
      await assert.rejects(call("downloads.missingAction", "deleteAll"), /Refused/);
      await assert.rejects(call("downloads.missingAction", "downloadAll", -1), /Refused/);
      await assert.rejects(
        call("downloads.missingAction", "downloadAll", { kind: "album", id: -1 }),
        /Refused/,
      );
      await assert.rejects(call("downloads.list", "7"), /Refused/);
      await assert.rejects(call("downloads.list", { kind: "songs" }), /Refused/);
      await assert.rejects(call("downloads.retry", [7]), /Refused/);
      await assert.rejects(call("downloads.cancel", "abcdefghijk"), /Refused/);
      await assert.rejects(call("downloads.rows", 0, 10_000), /Refused/);
      await assert.rejects(call("downloads.setBestQuality", "on"), /Refused/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("main refuses playlist calls with a bad playlist, name, page, answer or framing", async () => {
  await withFile(async (file) => {
    const { runtime, handlers } = connect(file);
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      await assert.rejects(call("playlists.create", "x".repeat(501)), /refused/i);
      await assert.rejects(
        call("playlists.create", "A", { scope: { kind: "albums" } }),
        /refused/i,
      );
      await assert.rejects(call("playlists.rename", 0, "A"), /refused/i);
      await assert.rejects(call("playlists.move", 1, 1, "left"), /refused/i);
      await assert.rejects(call("playlists.graveyard", 1, 0, 201), /refused/i);
      await assert.rejects(call("playlists.forget", 1, "all"), /refused/i);
      await assert.rejects(call("playlists.runImport", ["delete"]), /refused/i);
      await assert.rejects(
        call("playlists.saveImage", 1, { zoom: Number.NaN, centerX: 0.5, centerY: 0.5 }),
        /refused/i,
      );
      await assert.rejects(call("playlists.image", 1, "large"), /refused/i);
      // Remove from Playlist acts only on a playlist's own list.
      await assert.rejects(
        call("songs.run", { scope: { kind: "songs" }, ids: [1] }, "removeFromPlaylist"),
        /refused/i,
      );
      await assert.rejects(call("playlists.runImport", []), /Nothing to import/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Copy Link puts a song's share link on the clipboard, and pasted text that is no link does nothing", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers, copied, engineCalls } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      assert.deepEqual(await wave.links.copySong("abcdefghijk"), {
        kind: "copied",
        message: "Link copied",
      });
      assert.deepEqual(copied, ["https://song.link/y/abcdefghijk"]);
      const before = engineCalls.length;
      assert.deepEqual(await wave.links.open("Pink Moon by Nick Drake"), { kind: "ignored" });
      assert.equal(engineCalls.length, before);
      assert.equal(copied.length, 1);
      await assert.rejects(call("links.open", 7), /refused/i);
      await assert.rejects(call("links.open", "x".repeat(16_385)), /refused/i);
      await assert.rejects(call("links.copySong", "not a video"), /refused/i);
      await assert.rejects(call("links.copyPlaylist", 0), /refused/i);
      await assert.rejects(call("links.importPlaylist", "token", "yes"), /refused/i);
      // Main answers in the language it resolved, whatever the window believes.
      await wave.settings.setLanguage("pt-BR");
      assert.deepEqual(await wave.links.copySong("abcdefghijk"), {
        kind: "copied",
        message: "Link copiado",
      });
      assert.equal(await wave.playlists.newName(), "Nova Playlist");
    } finally {
      await runtime.dispose();
    }
  });
});

test("YouTube's sign-in shows the account, and one of its playlists is imported with its YT songs", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers, browser, jvm, yt } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    const account = { name: "Ana", email: "ana@example.com", photoUrl: null };
    try {
      const localId = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          return addTrack(db, {
            title: "Pink Moon",
            artist: "Nick Drake",
            album: "Pink Moon",
            durationMs: 124_000,
          });
        }),
      );
      await wave.settings.setYtMusic(true);
      assert.deepEqual(await wave.ytAccount.view(), {
        account: { kind: "signedOut", action: "signIn", note: "optional" },
        keyringMissing: false,
        noBrowser: false,
      });
      await wave.ytAccount.signIn();
      assert.equal((await wave.ytAccount.view()).noBrowser, true);

      // A made-up cookie under the names YouTube's have: no account's.
      browser.outcome = {
        kind: "signedIn",
        cookie: "SAPISID=fake-value",
        dataSyncId: null,
        sessionIndex: "0",
      };
      jvm.answers = {
        ytSignIn: { status: "signedIn", account },
        libraryPlaylists: [
          { playlistId: "PLroad", title: "Road", artworkUrl: null, songCount: 2, kind: "own" },
        ],
        playlist: {
          title: "Road",
          artworkUrl: null,
          songs: [ytSongNamed("abcdefghijk", "Pink Moon"), ytSongNamed("bcdefghijkl", "Road")],
          continuation: null,
        },
      };
      await wave.ytAccount.signIn();
      assert.ok(yt.includes('ytSignIn {"cookie":"SAPISID=fake-value","sessionIndex":"0"}'));
      const view = await wave.ytAccount.view();
      assert.deepEqual(view.account, { kind: "account", account, action: "signOut" });
      assert.ok(!JSON.stringify(view).includes("fake-value"), "the window never gets the cookie");

      assert.deepEqual(await wave.ytAccount.playlists("en"), {
        status: "ok",
        playlists: [
          { playlistId: "LM", title: "Liked Songs", artworkUrl: null, line: null },
          { playlistId: "PLroad", title: "Road", artworkUrl: null, line: "2 songs" },
        ],
      });
      const opened = await wave.links.open("https://music.youtube.com/playlist?list=PLroad");
      assert.equal(opened.kind, "playlist");
      if (opened.kind !== "playlist") return;
      assert.equal(opened.view.canImport, true);
      const saved = await wave.links.importPlaylist(opened.token, false);
      const songs = await wave.library.browse({ kind: "playlist", id: saved.playlistId }, 0, 10);
      assert.deepEqual(
        songs.items.map((row) => [row.title, row.videoId ?? row.id]),
        [
          ["Pink Moon", localId],
          ["Road", "bcdefghijkl"],
        ],
      );
      assert.equal(songs.total, 2);
      assert.equal(new Set(songs.items.map((row) => row.id)).size, 2, "each row has its own id");

      // The playlist keeps the Library song and starts playback at the clicked YT song.
      await wave.playback.start({ kind: "playlist", id: saved.playlistId }, 1);
      assert.equal((await wave.playback.view()).current?.videoId, "bcdefghijkl");
      assert.deepEqual(
        (await wave.playback.queue(0, 10)).items.map((row) => [row.videoId ?? row.id, row.current]),
        [
          [localId, false],
          ["bcdefghijkl", true],
        ],
      );
      await assert.rejects(call("ytAccount.playlists", "fr"), /refused/i);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Search ranks the Library as the phone does, plays a result alone and keeps recent searches", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(trusted, ...args);
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          for (const [n, title] of ["Parasite", "Pink Moon", "Road"].entries())
            addTrack(db, { title, artist: "Nick Drake", album: "Pink Moon", trackNumber: n + 1 });
        }),
      );
      const view = await wave.search.library("pink moon");
      assert.deepEqual([view.top?.kind, view.top?.row.title], ["album", "Pink Moon"]);
      const songs = view.groups.find((group) => group.kind === "song")!;
      assert.equal(songs.items[0]?.title, "Pink Moon", "its title beats an album match");
      await wave.playback.start({ kind: "search", query: "pink moon" }, 1);
      const playing = await wave.playback.view();
      assert.equal(playing.current?.title, songs.items[1]?.title);
      assert.equal(playing.length, 1, "a song from search plays alone");

      assert.deepEqual((await wave.search.recent()).items, []);
      await wave.search.remember("Pink moon");
      await wave.search.remember("road ");
      assert.deepEqual((await wave.search.remember("pink MOON")).items, ["pink MOON", "road"]);
      assert.deepEqual((await wave.search.recent()).items, ["pink MOON", "road"]);
      await wave.search.clearRecent();
      assert.deepEqual((await wave.search.recent()).items, []);

      await assert.rejects(call("search.library", 7), /Refused/);
      await assert.rejects(call("search.library", "x".repeat(501)), /Refused/);
      await assert.rejects(call("search.remember", null), /Refused/);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Home downloads a missing song without disturbing playback and plays its imported file", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, downloads } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const id = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const id = addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
          db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${id}`);
          star(db, id, 400);
          return id;
        }),
      );
      await wave.home.play("favorites", 0);
      assert.equal((await wave.playback.view()).current, null);
      assert.ok(
        downloads.some(
          (line) => line.startsWith("downloads.enqueueAll ") && line.includes(`missing:${id}`),
        ),
      );
      await runtime.runPromise(
        Effect.gen(function* () {
          const library = yield* DesktopLibrary;
          writeFileSync(join(dirname(file), "Road.mp3"), "audio fixture");
          yield* Effect.promise(() =>
            library.importFile(join(dirname(file), "Road.mp3"), { videoId: null, fills: id }),
          );
        }),
      );
      for (let i = 0; i < 40 && (await wave.playback.view()).current === null; i++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal((await wave.playback.view()).current?.id, id);
      assert.equal((await wave.playback.view()).status.state, "playing");
    } finally {
      await runtime.dispose();
    }
  });
});

test("Download from selection queues only missing songs and reports the count", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, downloads } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const ids = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const ids = [
            addTrack(db, { title: "Road" }),
            addTrack(db, { title: "Moon" }),
            addTrack(db, { title: "Local" }),
          ];
          db.run(sql`UPDATE tracks SET path = NULL WHERE id IN (${ids[0]}, ${ids[1]})`);
          return ids;
        }),
      );
      const target = { scope: { kind: "songs" as const }, ids };
      assert.ok(
        (await wave.songs.actions(target, "selection")).entries.some(
          (entry) => entry.action === "download",
        ),
      );
      assert.deepEqual(await wave.songs.run(target, "download"), { kind: "downloaded", count: 2 });
      const asked = downloads.find((line) => line.startsWith("downloads.enqueueAll "))!;
      assert.ok(asked.includes(`missing:${ids[0]}`));
      assert.ok(asked.includes(`missing:${ids[1]}`));
      assert.ok(!asked.includes(`missing:${ids[2]}`));
    } finally {
      await runtime.dispose();
    }
  });
});

test("a file that failed playback is marked separately from a missing song", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, broken, handlers } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const id = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          return addTrack(db, { title: "Broken" });
        }),
      );
      broken.add("Broken.mp3");
      await assert.rejects(wave.playback.start({ kind: "songs" }, 0));
      assert.deepEqual((await wave.songs.states([id])).items, [
        { id, failed: true, download: null },
      ]);
      await wave.playback.command({ type: "setRepeat", mode: "all" });
      assert.equal((await wave.songs.states([id])).items[0]?.failed, true);
      broken.clear();
      await wave.playback.start({ kind: "songs" }, 0);
      assert.equal((await wave.songs.states([id])).items[0]?.failed, false);
      await assert.rejects(
        handlers.get("songs.states")!(
          trusted,
          Array.from({ length: 201 }, (_, n) => n + 1),
        ),
        /Refused/,
      );
    } finally {
      await runtime.dispose();
    }
  });
});

test("Play on a long list with missing songs plays the songs that have a file", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          for (let n = 0; n < 1_200; n++)
            addTrack(db, { title: `Song ${String(n).padStart(4, "0")}` });
          db.run(sql`UPDATE tracks SET path = NULL WHERE title IN ('Song 0000', 'Song 0001')`);
        }),
      );
      await wave.playback.start({ kind: "songs" }, 0, false);
      assert.equal((await wave.playback.view()).current, null);
      await wave.playback.start({ kind: "songs" }, undefined, false);
      const view = await wave.playback.view();
      assert.equal(view.current?.title, "Song 0002");
      assert.equal((await wave.playback.queue(0, 1)).total, 1_198);
    } finally {
      await runtime.dispose();
    }
  });
});

test("Play and Shuffle on a list where nothing can play say so, with its missing songs to download", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, downloads } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, { title: "Road", album: "Pink Moon", trackNumber: 2 });
          addTrack(db, { title: "Pink Moon", album: "Pink Moon", trackNumber: 1 });
          db.run(sql`UPDATE tracks SET path = NULL`);
        }),
      );
      const album = (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!;
      const scope = { kind: "album" as const, id: album.id };
      assert.deepEqual(await wave.playback.start(scope, undefined, false), {
        kind: "nothing",
        missing: 2,
        unavailable: 0,
      });
      assert.deepEqual(await wave.playback.start(scope, undefined, true), {
        kind: "nothing",
        missing: 2,
        unavailable: 0,
      });
      assert.equal((await wave.playback.view()).current, null);
      assert.ok(
        !downloads.some((line) => line.startsWith("downloads.enqueueAll ")),
        "Play downloads nothing by itself",
      );
    } finally {
      await runtime.dispose();
    }
  });
});

test("Play on a list where nothing can play counts the songs on a disconnected drive, none for an empty playlist", async () => {
  await withFile(async (file) => {
    const music = join(dirname(file), "Music");
    mkdirSync(music);
    writeFileSync(join(music, "One.flac"), "music");
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const library = await runtime.runPromise(DesktopLibrary);
      await library.refresh();
      const playlistId = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          return createPlaylist(db, "Evening", [], 1000).playlistId;
        }),
      );
      assert.deepEqual(await wave.playback.start({ kind: "playlist", id: playlistId }), {
        kind: "nothing",
        missing: 0,
        unavailable: 0,
      });
      rmSync(music, { recursive: true });
      await library.refresh();
      assert.deepEqual(await wave.playback.start({ kind: "songs" }), {
        kind: "nothing",
        missing: 0,
        unavailable: 1,
      });
    } finally {
      await runtime.dispose();
    }
  });
});

test("Play streams the missing songs YouTube Music has and counts the ones it leaves out", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, { title: "Gone", album: "Pink Moon", trackNumber: 1 });
          addTrack(db, { title: "Streamed", album: "Pink Moon", trackNumber: 2 });
          addTrack(db, { title: "Here", album: "Pink Moon", trackNumber: 3 });
          db.run(sql`UPDATE tracks SET path = NULL WHERE title IN ('Gone', 'Streamed')`);
          db.run(sql`UPDATE tracks SET video_id = 'streamedvid' WHERE title = 'Streamed'`);
        }),
      );
      const album = (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!;
      const scope = { kind: "album" as const, id: album.id };
      assert.deepEqual(await wave.playback.start(scope, undefined, false), {
        kind: "playing",
        streamed: 1,
        leftOut: 1,
      });
      const queue = await wave.playback.queue(0, 10);
      assert.deepEqual(
        queue.items.map((row) => [row.title, row.videoId ?? null]),
        [
          ["Streamed", "streamedvid"],
          ["Here", null],
        ],
      );

      await wave.settings.setYtMusic(false);
      assert.deepEqual(await wave.playback.start(scope, undefined, false), {
        kind: "playing",
        streamed: 0,
        leftOut: 2,
      });
      assert.equal((await wave.playback.view()).current?.title, "Here");
      assert.equal((await wave.playback.queue(0, 10)).total, 1);
    } finally {
      await runtime.dispose();
    }
  });
});

test("a missing song streamed from a list keeps the YouTube Music album Wave knows it by", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          addTrack(db, { title: "Pink Moon", album: "Pink Moon", trackNumber: 1 });
          addTrack(db, { title: "Unseen", album: "Pink Moon", trackNumber: 2 });
          db.run(sql`UPDATE tracks SET path = NULL`);
          db.run(sql`UPDATE tracks SET video_id = 'abcdefghijk' WHERE title = 'Pink Moon'`);
          db.run(sql`UPDATE tracks SET video_id = 'unseenvideo' WHERE title = 'Unseen'`);
        }),
      );
      await wave.yt.search("pink moon");
      const album = (await wave.library.browse({ kind: "albums" }, 0, 1)).items[0]!;
      await wave.playback.start({ kind: "album", id: album.id }, undefined, false);
      const albumOf = async (videoId: string) =>
        (await wave.streamed.menu(videoId)).entries.flatMap((entry) =>
          entry.action === "goToAlbum" ? [entry.album] : [],
        );
      assert.deepEqual(await albumOf("abcdefghijk"), ["MPREb_pinkmoon"]);
      assert.deepEqual(await albumOf("unseenvideo"), []);
    } finally {
      await runtime.dispose();
    }
  });
});

test("playlist, artist and genre pages download their missing songs in page order", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, downloads } = connect(file);
    const wave = exposed.get("wave") as WaveBridge;
    try {
      const { ids, playlistId } = await runtime.runPromise(
        Effect.gen(function* () {
          const db = (yield* Database) as unknown as TestDatabase;
          const ids = [
            addTrack(db, { title: "Road", artist: "Nick Drake", genre: "Folk" }),
            addTrack(db, { title: "Moon", artist: "Nick Drake", genre: "Folk" }),
            addTrack(db, { title: "Here", artist: "Nick Drake", genre: "Folk" }),
          ];
          db.run(sql`UPDATE tracks SET path = NULL WHERE id IN (${ids[0]}, ${ids[1]})`);
          const playlistId = createPlaylist(
            db,
            "Evening",
            [ids[1]!, ids[2]!, ids[0]!].map((trackId) => ({ source: "library" as const, trackId })),
            1000,
          ).playlistId;
          return { ids, playlistId };
        }),
      );
      const playlist = { kind: "playlist" as const, id: playlistId };
      const view = await wave.downloads.list(playlist);
      assert.equal(view?.count, 2);
      assert.equal(view?.line, "2 songs aren't on this computer");
      assert.deepEqual(view?.actions, ["downloadAll"]);
      await wave.downloads.missingAction("downloadAll", playlist);
      const asked = downloads.find((line) => line.startsWith("downloads.enqueueAll "))!;
      assert.ok(
        asked.indexOf(`missing:${ids[1]}`) < asked.indexOf(`missing:${ids[0]}`),
        "in playlist order",
      );
      assert.ok(!asked.includes(`missing:${ids[2]}`));
      assert.ok(
        asked.includes(`"origin":{"kind":"playlist","id":"${playlistId}","name":"Evening"}`),
      );

      const artist = (await wave.library.browse({ kind: "artists" }, 0, 1)).items[0]!;
      assert.equal((await wave.downloads.list({ kind: "artist", id: artist.id }))?.count, 2);
      const genre = (await wave.library.browse({ kind: "genres" }, 0, 1)).items[0]!;
      assert.equal((await wave.downloads.list({ kind: "genre", id: genre.id }))?.count, 2);
      assert.equal(await wave.downloads.list({ kind: "playlist", id: 999 }), null);
    } finally {
      await runtime.dispose();
    }
  });
});
