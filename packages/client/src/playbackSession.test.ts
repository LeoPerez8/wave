import assert from "node:assert/strict";
import { test } from "node:test";
import { homePlays } from "./db/playHistory.ts";
import { playEvents } from "./db/schema.ts";
import { addTrack, openTestDatabase, libraryRow } from "./db/testDatabase.ts";
import {
  createPlaybackSession,
  type AudioPort,
  type AudioStatus,
  type PlaybackSession,
} from "./playbackSession.ts";

const device = (): AudioPort & { preloaded: () => string | undefined; forget: () => void } => {
  let state: AudioStatus = { state: "idle", positionMs: 0 };
  let preloaded: string | undefined;
  return {
    preloaded: () => preloaded,
    // The audio process restarted: its preloaded song is gone.
    forget: () => {
      preloaded = undefined;
    },
    load: async (path, key) =>
      (state = {
        state: "paused",
        positionMs: 0,
        key,
        durationMs: path.includes("Short") ? 1000 : 60000,
      }),
    preload: async (_path, key) => {
      preloaded = key;
      return state;
    },
    play: async () => (state = { ...state, state: "playing" }),
    pause: async () => (state = { ...state, state: "paused" }),
    seek: async (positionMs) => (state = { ...state, positionMs }),
    status: async () => state,
  };
};

test("replacing playback offers Undo to the old queue at its position, and launch restores paused", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const b = addTrack(db, { title: "Second" });
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(a), String(b)],
    context: { kind: "album", id: "1" },
  });
  await session.seek(12000);
  await session.dispatch({
    type: "play",
    trackIds: [String(b)],
    context: { kind: "songs", id: null },
  });
  assert.equal(session.snapshot().canUndo, true);
  await session.undo();
  assert.deepEqual(
    session.snapshot().queue.entries.map((e) => e.trackId),
    [String(a), String(b)],
  );
  assert.equal(session.snapshot().status.positionMs, 12000);
  assert.equal(session.snapshot().status.state, "playing");
  await session.flush();
  const restored = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => restored.close());
  assert.equal(restored.snapshot().status.state, "paused");
  assert.equal(restored.snapshot().status.positionMs, 12000);
  assert.equal(restored.snapshot().queue.context?.kind, "album");
});

test("only listening counts: seeking and paused time add nothing, and short songs count on completion", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "Long", durationMs: 60000 });
  const b = addTrack(db, { title: "Short", durationMs: 1000 });
  let now = 1000;
  const session = await createPlaybackSession({
    db,
    audio: device(),
    source: "desktop",
    now: () => now,
  });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(a), String(b)],
    context: { kind: "songs", id: null },
  });
  now += 15000;
  await session.seek(45000);
  await session.pause();
  now += 60000;
  await session.dispatch({ type: "next" });
  await session.play();
  assert.equal(homePlays(db).mostPlayed.length, 0);
  const key = session.snapshot().status.key!;
  now += 1000;
  await session.feed({ key, state: "ended", positionMs: 1000, durationMs: 1000 });
  assert.equal(homePlays(db).mostPlayed.map(libraryRow)[0]?.id, b);
  assert.equal(homePlays(db).mostPlayed[0]?.playCount, 1);
  await session.dispatch({ type: "previous", positionMs: 0 });
  await session.play();
  now += 15001;
  await session.pause();
  assert.equal(
    homePlays(db)
      .mostPlayed.map(libraryRow)
      .find((p) => p.id === a)?.playCount,
    1,
  );
});

test("Previous after three seconds restarts a paused song without resuming it", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(a)],
    context: { kind: "songs", id: null },
  });
  await session.seek(4000);
  await session.pause();
  await session.dispatch({ type: "previous", positionMs: 4000 });
  assert.equal(session.snapshot().status.state, "paused");
  assert.equal(session.snapshot().status.positionMs, 0);
});

test("clearing the queue stops playback and a later launch keeps it empty", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(a)],
    context: { kind: "songs", id: null },
  });
  await session.dispatch({ type: "play", trackIds: [], context: { kind: "songs", id: null } });
  assert.equal(session.snapshot().queue.entries.length, 0);
  assert.equal(session.snapshot().status.state, "idle");
});

test("an older engine report cannot resume a song after its pause was accepted", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(a)],
    context: { kind: "songs", id: null },
  });
  const key = session.snapshot().status.key;
  await session.feed({ key, state: "paused", positionMs: 400, observedAtMs: 2000 });
  await session.feed({ key, state: "playing", positionMs: 300, observedAtMs: 1000 });
  assert.equal(session.snapshot().status.state, "paused");
  assert.equal(session.snapshot().status.positionMs, 400);
});

const album = async (
  t: { after: (fn: () => unknown) => void },
  extra: Partial<Parameters<typeof createPlaybackSession>[0]> = {},
) => {
  const db = await openTestDatabase();
  const ids = [
    addTrack(db, { title: "First" }),
    addTrack(db, { title: "Second" }),
    addTrack(db, { title: "Third" }),
  ];
  const audio = device();
  const session = await createPlaybackSession({ db, audio, source: "desktop", ...extra });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: ids.map(String),
    context: { kind: "album", id: "1" },
  });
  await session.play();
  const keys = session.snapshot().queue.entries.map((e) => e.key);
  return { db, ids, audio, session, keys };
};
const current = (session: PlaybackSession) =>
  session.snapshot().queue.entries[session.snapshot().queue.index]?.key;

test("the engine moving on to the preloaded song advances the queue and counts the song it finished", async (t) => {
  let now = 1000;
  const { db, ids, audio, session, keys } = await album(t, { now: () => now });
  assert.equal(audio.preloaded(), keys[1]);
  now += 60000;
  await session.feed({ key: keys[1], state: "playing", positionMs: 40 }, [
    { key: keys[1]!, atMs: now - 40 },
  ]);
  assert.equal(current(session), keys[1]);
  assert.equal(session.snapshot().status.positionMs, 40);
  assert.equal(audio.preloaded(), keys[2]);
  assert.equal(homePlays(db).mostPlayed.map(libraryRow)[0]?.id, ids[0]);
});

test("a report from the preloaded song catches the queue up when its transition went missing", async (t) => {
  const { audio, session, keys } = await album(t);
  await session.feed({ key: keys[1], state: "playing", positionMs: 500 });
  assert.equal(current(session), keys[1]);
  assert.equal(session.snapshot().status.positionMs, 500);
  assert.equal(audio.preloaded(), keys[2]);
});

test("a report about a song the queue no longer holds changes nothing", async (t) => {
  const { session, keys } = await album(t);
  await session.feed({ key: "999", state: "paused", positionMs: 500 });
  assert.equal(current(session), keys[0]);
  assert.equal(session.snapshot().status.state, "playing");
});

test("a song that ends with nothing preloaded loads the next one and keeps playing", async (t) => {
  const { audio, session, keys } = await album(t);
  audio.forget();
  await session.feed({ key: keys[0], state: "ended", positionMs: 60000, durationMs: 60000 });
  assert.equal(current(session), keys[1]);
  assert.equal(session.snapshot().status.state, "playing");
});

test("Next ends the play as skipped by Next; Previous and a jump don't", async (t) => {
  const ended: boolean[] = [];
  const { session, keys } = await album(t, { playEnded: (_play, byNext) => ended.push(byNext) });
  await session.dispatch({ type: "next" });
  await session.dispatch({ type: "previous", positionMs: 0 });
  await session.dispatch({ type: "jumpTo", key: keys[2]! });
  assert.deepEqual(ended, [true, false, false]);
});

test("a fresh report still applies an engine transition queued behind an older status", async (t) => {
  const { session, keys } = await album(t);
  await session.feed({ key: keys[0], state: "playing", positionMs: 900, observedAtMs: 5000 });
  await session.feed({ key: keys[1], state: "playing", positionMs: 10, observedAtMs: 4000 }, [
    { key: keys[1]!, atMs: 3990 },
  ]);
  assert.equal(current(session), keys[1]);
});

test("YT Music songs play from their yt: path between Library songs, and their plays keep the song", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "Library" });
  const streamed = {
    videoId: "abcdefghijk",
    title: "Streamed",
    artists: ["Someone"],
    album: null,
    albumId: null,
    durationMs: 60000,
    artworkUrl: null,
    explicit: false,
  };
  const loaded: string[] = [];
  const preloaded: (string | undefined)[] = [];
  const audio = device();
  let now = 1000;
  const session = await createPlaybackSession({
    db,
    audio: {
      ...audio,
      load: (path, key) => {
        loaded.push(path);
        return audio.load(path, key);
      },
      preload: (path, key) => {
        preloaded.push(path);
        return audio.preload(path, key);
      },
    },
    source: "desktop",
    now: () => now,
    streamed: (videoId) => (videoId === streamed.videoId ? streamed : undefined),
  });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: ["yt:abcdefghijk", "yt:unknownsong", String(a)],
    context: { kind: "search", id: null },
  });
  assert.deepEqual(loaded, ["yt:abcdefghijk"]);
  assert.match(String(preloaded.at(-1)), /Library\.mp3$/, "an unknown streamed song is skipped");
  await session.play();
  now += 40000;
  await session.pause();
  const play = db
    .select()
    .from(playEvents)
    .all()
    .find((row) => row.videoId !== null);
  assert.equal(play?.videoId, "abcdefghijk");
  assert.equal(play?.streamedSong?.title, "Streamed");
});
