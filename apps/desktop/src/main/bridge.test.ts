import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
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
import { registerBridge, type IpcHandler } from "./bridge.ts";
import { DesktopLibrary, desktopLibraryLayer } from "./library/library.ts";

const trusted = { senderFrame: "window" };

/** Main's handlers wired to a preload through an in-memory IPC, as Electron does. */
/** An audio process in memory, whose engine records what it was asked. */
const audioInMemory = () => {
  const engineCalls: string[] = [];
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: AddonEngine = {
    load: (path) => {
      engineCalls.push(`load ${path}`);
      status = { state: "paused", positionMs: 0, durationMs: 1_000 };
      return status;
    },
    play: () => {
      if (status.state === "idle") throw new Error("[nothing-loaded] no song is loaded");
      status = { ...status, state: "playing" };
    },
    pause: () => void (status = { ...status, state: "paused" }),
    seek: (positionMs) => void (status = { ...status, positionMs }),
    status: () => status,
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
    desktopLibraryLayer({
      musicFolder: join(dirname(file), "Music"),
      platform: process.platform,
      pickFolder: async () => undefined,
    }).pipe(Layer.provideMerge(Layer.mergeAll(libraryLayer(file), audio.layer, jvm.layer))),
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
    assert.deepEqual(engineCalls, [`load ${song}`]);
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
    assert.deepEqual(engineCalls, []);
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
