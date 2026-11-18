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
import type { SyncClock } from "@wave/core";
import { createPlaylist } from "@wave/client/db/playlists";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { exposeBridge } from "../preload/expose.ts";
import { BRIDGE_CALLS, type WaveBridge } from "../shared/bridge.ts";
import type { PlaybackStatus } from "../shared/playback.ts";
import { answer, type AddonEngine } from "./audio/protocol.ts";
import { playerLayer } from "./audio/player.ts";
import type { AudioEvents } from "./audio/supervisor.ts";
import { kotlinLayer } from "./kotlin/kotlin.ts";
import type { KotlinEvents } from "./kotlin/supervisor.ts";
import type { SongTags } from "../shared/tags.ts";
import { libraryLayer } from "./database.ts";
import { playbackLayer } from "./playback/playback.ts";
import { registerBridge, type IpcHandler } from "./bridge.ts";
import { DesktopLibrary, desktopLibraryLayer } from "./library/library.ts";
import { accountLayer } from "./account/accountLayer.ts";
import { createWaveAccount, type WaveAccountService } from "./account/account.ts";
import { sessionStore } from "./account/sessionStore.ts";
import { desktop, keyring } from "./account/testAccount.ts";
import { pullAll } from "../../../sync/src/testing.ts";
import { fakeClock } from "../../../../packages/core/src/testSyncClock.ts";

const trusted = { senderFrame: "window" };

/** Main's handlers wired to a preload through an in-memory IPC, as Electron does. */
/** An audio process in memory, whose engine records what it was asked. */
const audioInMemory = () => {
  const engineCalls: string[] = [];
  /** Each song's Normalize Volume gain as it was loaded or lined up, and the files measured. */
  const gains: string[] = [];
  const measured: string[] = [];
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: AddonEngine = {
    load: (path, key, gainDb) => {
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
    send: (request: Parameters<typeof answer>[1]) =>
      queueMicrotask(() => events.message(answer(engine, request))),
    kill: () => setImmediate(events.exit),
  });
  return { layer: playerLayer({ fork }), engineCalls, gains, measured };
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

/** A JVM in memory that reads tags as the shared Kotlin does, and records the paths it read. */
const jvmInMemory = () => {
  const reads: string[] = [];
  const spawn = (events: KotlinEvents) => ({
    write: (text: string) => {
      const { id, params } = JSON.parse(text) as { id: number; params: { path: string } };
      reads.push(params.path);
      const answer = params.path.includes("unreadable")
        ? { id, error: { code: "ERR_UNEXPECTED", message: "FileNotFoundException" } }
        : { id, result: tagsTitled(basename(params.path)) };
      queueMicrotask(() => events.line(JSON.stringify(answer)));
    },
    kill: () => setImmediate(events.exit),
  });
  return { layer: kotlinLayer({ spawn }), reads };
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
  const library = desktopLibraryLayer({
    musicFolder: join(dirname(file), "Music"),
    platform: process.platform,
    pickFolder: async () => undefined,
  }).pipe(Layer.provideMerge(Layer.mergeAll(libraryLayer(file), audio.layer, jvm.layer)));
  const runtime = ManagedRuntime.make(
    accountLayer({
      account: account.service,
      focused: () => true,
      ...(account.clock === undefined ? {} : { clock: account.clock }),
    }).pipe(Layer.provideMerge(playbackLayer.pipe(Layer.provideMerge(library)))),
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
    reads: jvm.reads,
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
        (await wave.library.browse({ kind: "playlist", id: night.id }, 0, 10)).items.map(
          (row) => [row.title, row.path === null],
        ),
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
        { action: "addToPlaylist" },
        { action: "favorite" },
        { action: "goToAlbum", albumId: album.id },
        { action: "goToArtist", artists: { kind: "open", artistId: menu.artists[0]!.id } },
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
        ["playNext", "addToQueue", "addToPlaylist", "favorite", "goToArtist", "removeFromLibrary"],
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
