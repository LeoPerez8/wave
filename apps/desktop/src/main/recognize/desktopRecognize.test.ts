import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveRecognizedSong,
  type RecognizeAnswer,
  type RecognizedSong,
  type RecognizeTrack,
} from "@wave/core";
import type { KotlinEvent } from "../kotlin/protocol.ts";
import { createDesktopRecognize, type DesktopRecognizePorts } from "./desktopRecognize.ts";

const SONG: RecognizedSong = {
  title: "Teardrop",
  artist: "Massive Attack",
  album: "Mezzanine",
  coverUrl: null,
  isrc: null,
  releaseYear: 1998,
};

const TEARDROP: RecognizeTrack = {
  id: 4,
  title: "Teardrop",
  artist: "Massive Attack",
  album: "Mezzanine",
  durationMs: 330_000,
};

/** Lets pending promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

/** A JVM whose Shazam answers [answer], a player, and a capture the test drives. */
const fakes = (
  options: { answer?: RecognizeAnswer; microphone?: "granted" | "denied"; online?: boolean } = {},
) => {
  const listeners = new Set<(event: KotlinEvent) => void>();
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const log: string[] = [];
  const player = { playing: true, paused: 0, played: 0 };
  const emit = (event: KotlinEvent) => {
    for (const listener of listeners) listener(event);
  };
  const ports: DesktopRecognizePorts<RecognizeTrack> = {
    kotlin: async (method, params) => {
      calls.push({ method, params: params as Record<string, unknown> });
      if (method === "recognize.start") return (params as { session: number }).session;
      if (method === "recognize.ask") return options.answer ?? { kind: "match", song: SONG };
      return null;
    },
    events: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    online: () => options.online ?? true,
    microphone: () => options.microphone ?? "granted",
    systemAudio: "loopback",
    locale: () => "en",
    playback: {
      playing: () => player.playing,
      pause: async () => {
        player.paused++;
        player.playing = false;
      },
      play: async () => {
        player.played++;
        player.playing = true;
      },
    },
    resolve: async (song) => {
      const resolved = resolveRecognizedSong(song, [TEARDROP]);
      if (resolved.kind !== "resolved") throw new Error("The test's Library has the song");
      return resolved;
    },
    log: (level, line) => log.push(`${level}: ${line}`),
    now: () => 0,
    every: () => () => {},
  };
  const heard = (session: number, ms: number) =>
    emit({ event: "recognizeHeard", session, heardMs: ms, audible: true });
  return { ports, calls, log, player, emit, heard };
};

test("listening through the microphone captures it for the session, pauses Wave and names the song", async () => {
  const { ports, calls, player, heard } = fakes();
  const recognize = createDesktopRecognize(ports);
  assert.equal(recognize.state().open, false);
  recognize.start("microphone");
  assert.deepEqual(recognize.state().card, { kind: "listening" });
  await settle();
  const capture = recognize.state().capture;
  assert.equal(capture?.via, "microphone");
  assert.equal(player.paused, 1, "the microphone mustn't hear Wave");
  assert.ok(recognize.allows("microphone"));
  assert.ok(!recognize.allows("systemAudio"));

  recognize.audio(capture!.session, new Uint8Array([1, 0, 2, 0]));
  await settle();
  const sent = calls.find((call) => call.method === "recognize.audio");
  assert.deepEqual(sent?.params, { session: capture!.session, pcm: "AQACAA==" });

  heard(capture!.session, 4_000);
  await settle();
  assert.deepEqual(recognize.state().card.kind, "resolved");
  const card = recognize.state().card;
  assert.ok(card.kind === "resolved" && card.result.kind === "library");
  assert.equal(recognize.state().capture, null, "the capture stops with the session");
  assert.ok(!recognize.allows("microphone"));
  assert.equal(player.played, 1, "playback resumes after");
  assert.ok(calls.some((call) => call.method === "recognize.stop"));
});

test("what the computer plays is captured as loopback audio and leaves playback alone", async () => {
  const { ports, player } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.start("playback");
  await settle();
  assert.deepEqual(recognize.state().card, { kind: "listening", source: "playback" });
  assert.equal(recognize.state().capture?.via, "loopback");
  assert.ok(recognize.allows("systemAudio"));
  assert.ok(!recognize.allows("microphone"));
  assert.equal(player.paused, 0);
});

test("audio for a session that isn't captured is dropped", async () => {
  const { ports, calls } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.audio(3, new Uint8Array([1, 0]));
  recognize.start("microphone");
  await settle();
  recognize.audio(recognize.state().capture!.session + 1, new Uint8Array([1, 0]));
  await settle();
  assert.ok(!calls.some((call) => call.method === "recognize.audio"));
});

test("no match shows its line with Try Again", async () => {
  const { ports, heard } = fakes({ answer: { kind: "noMatch" } });
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  const { session } = recognize.state().capture!;
  for (let ms = 4_000; ms <= 28_000; ms += 4_000) {
    heard(session, ms);
    await settle();
  }
  assert.deepEqual(recognize.state().card, { kind: "ended", end: { kind: "noMatch" } });
});

test("offline, it says No connection without capturing", async () => {
  const { ports, calls } = fakes({ online: false });
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  assert.deepEqual(recognize.state().card, { kind: "offline" });
  assert.ok(!calls.some((call) => call.method === "recognize.start"));
});

test("with the system's microphone access off, it says so and captures nothing", async () => {
  const { ports, calls, player } = fakes({ microphone: "denied" });
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  assert.deepEqual(recognize.state().card, { kind: "denied" });
  assert.equal(recognize.state().capture, null);
  assert.ok(!calls.some((call) => call.method === "recognize.start"));
  assert.equal(player.paused, 0);
});

test("the system's microphone switch doesn't stop capturing what the computer plays", async () => {
  const { ports } = fakes({ microphone: "denied" });
  const recognize = createDesktopRecognize(ports);
  recognize.start("playback");
  await settle();
  assert.equal(recognize.state().capture?.via, "loopback");
});

test("a microphone the window was refused shows Microphone access is off and resumes playback", async () => {
  const { ports, player } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  recognize.captureEnded(recognize.state().capture!.session, "denied");
  await settle();
  assert.deepEqual(recognize.state().card, { kind: "denied" });
  assert.equal(recognize.state().capture, null);
  assert.equal(player.played, 1);
});

test("a capture that failed tells the JVM, whose report ends the session as a failure", async () => {
  const { ports, calls } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  const { session } = recognize.state().capture!;
  recognize.captureEnded(session, "failed");
  await settle();
  assert.ok(
    calls.some((call) => call.method === "recognize.end" && call.params.session === session),
  );
  assert.equal(recognize.state().capture, null);
});

test("closing the card cancels the session, stops the capture and resumes playback", async () => {
  const { ports, calls, player } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  recognize.close();
  await settle();
  assert.equal(recognize.state().open, false);
  assert.equal(recognize.state().capture, null);
  assert.ok(calls.some((call) => call.method === "recognize.stop"));
  assert.equal(player.played, 1);
});

test("Try Again starts a new attempt whose capture replaces the last one", async () => {
  const { ports } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  const first = recognize.state();
  recognize.start("playback");
  await settle();
  const second = recognize.state();
  assert.equal(second.attempt, first.attempt + 1);
  assert.equal(second.source, "playback");
  assert.notEqual(second.capture?.session, first.capture?.session);
});

test("a paused player isn't started after listening", async () => {
  const { ports, player } = fakes();
  player.playing = false;
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  recognize.close();
  await settle();
  assert.equal(player.played, 0);
});

test("the session writes its one log line", async () => {
  const { ports, log, heard } = fakes();
  const recognize = createDesktopRecognize(ports);
  recognize.start("microphone");
  await settle();
  heard(recognize.state().capture!.session, 4_000);
  await settle();
  assert.equal(log.length, 1);
  assert.match(log[0]!, /^info: Recognize through the microphone/);
});
