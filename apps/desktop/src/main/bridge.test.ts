import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
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

const trusted = { senderFrame: "window" };

/** Main's handlers wired to a preload through an in-memory IPC, as Electron does. */
/** An audio process in memory, whose engine records what it was asked. */
const audioInMemory = () => {
  const engineCalls: string[] = [];
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: AddonEngine = {
    load: (path, key) => {
      engineCalls.push(`load ${path}`);
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
  };
  const fork = (events: AudioEvents) => ({
    send: (request: Parameters<typeof answer>[1]) =>
      queueMicrotask(() => events.message(answer(engine, request))),
    kill: () => setImmediate(events.exit),
  });
  return { layer: playerLayer({ fork }), engineCalls };
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

const connect = (file: string, isTrusted = (event: unknown) => event === trusted) => {
  const audio = audioInMemory();
  const jvm = jvmInMemory();
  const runtime = ManagedRuntime.make(
    playbackLayer.pipe(
      Layer.provideMerge(
        desktopLibraryLayer({
          musicFolder: join(dirname(file), "Music"),
          platform: process.platform,
          pickFolder: async () => undefined,
        }).pipe(Layer.provideMerge(Layer.mergeAll(libraryLayer(file), audio.layer, jvm.layer))),
      ),
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
  return { runtime, handlers, exposed, sent, engineCalls: audio.engineCalls, reads: jvm.reads };
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
    // Playback sets the saved volume as it starts; the song is what this test plays.
    assert.deepEqual(
      engineCalls.filter((c) => !c.startsWith("volume")),
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
      engineCalls.filter((c) => !c.startsWith("volume")),
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
        engineCalls.filter((c) => !c.startsWith("volume")),
        [],
      );
    } finally {
      await runtime.dispose();
    }
  });
});
