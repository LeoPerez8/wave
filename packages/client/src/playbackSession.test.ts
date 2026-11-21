import assert from "node:assert/strict";
import { test } from "node:test";
import { homePlays } from "./db/playHistory.ts";
import { playEvents } from "./db/schema.ts";
import { loadPlayback } from "./db/playback.ts";
import { addTrack, openTestDatabase, libraryRow } from "./db/testDatabase.ts";
import { savedQueueState } from "@wave/core";
import {
  createPlaybackSession,
  type AudioPort,
  type AudioSongOptions,
  type AudioStatus,
  type PlaybackSession,
} from "./playbackSession.ts";

const device = (): AudioPort & {
  preloaded: () => string | undefined;
  forget: () => void;
  /** How the last song loaded, and the one lined up, are to play. */
  options: { loaded?: AudioSongOptions | undefined; lined?: AudioSongOptions | undefined };
} => {
  let state: AudioStatus = { state: "idle", positionMs: 0 };
  let preloaded: string | undefined;
  const options: { loaded?: AudioSongOptions; lined?: AudioSongOptions } = {};
  return {
    preloaded: () => preloaded,
    options,
    // The audio process restarted: its preloaded song is gone.
    forget: () => {
      preloaded = undefined;
    },
    load: async (path, key, how) => {
      options.loaded = how;
      return (state = {
        state: "paused",
        positionMs: 0,
        key,
        durationMs: path.includes("Short") ? 1000 : 60000,
      });
    },
    preload: async (_path, key, how) => {
      preloaded = key;
      options.lined = how;
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

test("pausing at a song's end lines nothing up, then leaves the next song paused at its start", async (t) => {
  const stops: string[] = [];
  const { audio, session, keys } = await album(t, { stopped: (why) => stops.push(why) });
  await session.pauseAtTrackEnd(true);
  assert.equal(audio.preloaded(), undefined);
  await session.feed({ key: keys[0], state: "ended", positionMs: 60000, durationMs: 60000 });
  assert.equal(current(session), keys[1]);
  assert.equal(session.snapshot().status.state, "paused");
  assert.equal(session.snapshot().status.positionMs, 0);
  assert.deepEqual(stops, ["trackEnd"]);
  await session.pauseAtTrackEnd(false);
  assert.equal(audio.preloaded(), keys[2]);
});

test("the queue playing out tells why playback stopped", async (t) => {
  const stops: string[] = [];
  const { session, keys } = await album(t, { stopped: (why) => stops.push(why) });
  await session.dispatch({ type: "jumpTo", key: keys[2]! });
  await session.feed({ key: keys[2], state: "ended", positionMs: 60000, durationMs: 60000 });
  assert.equal(session.snapshot().status.state, "paused");
  assert.deepEqual(stops, ["queueEnd"]);
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

test("a crossfade moves the queue on and the song fading out counts once its fade ends", async (t) => {
  let now = 1000;
  const ended: string[] = [];
  const { session, keys, audio, ids } = await album(t, {
    now: () => now,
    playEnded: (play) => ended.push(`${play.trackId}:${play.endReason}`),
  });
  assert.equal(audio.options.lined?.fade, true);
  now += 55000;
  await session.feed({ key: keys[1], state: "playing", positionMs: 100 }, [
    { key: keys[1]!, atMs: now - 100, kind: "crossfade" },
  ]);
  assert.equal(current(session), keys[1]);
  assert.equal(audio.preloaded(), keys[2]);
  assert.deepEqual(ended, [], "the first song still plays, fading out");
  now += 5000;
  await session.feed({ key: keys[1], state: "playing", positionMs: 5100 }, [
    { key: keys[0]!, atMs: now, kind: "fadeEnded" },
  ]);
  assert.deepEqual(ended, [`${ids[0]}:completed`]);
});

test("repeat one lines the song up again without a fade", async (t) => {
  const { session, audio } = await album(t);
  await session.dispatch({ type: "setRepeat", mode: "one" });
  assert.equal(audio.options.lined?.fade, false);
  await session.dispatch({ type: "setRepeat", mode: "all" });
  assert.equal(audio.options.lined?.fade, true);
});

test("each song loads and lines up at its Normalize Volume gain, read again once one is learned", async (t) => {
  const gains = new Map<string, number>();
  const { session, audio, ids } = await album(t, {
    gainDb: (_queue, entry) => gains.get(entry.trackId) ?? -5,
  });
  assert.equal(audio.options.loaded?.gainDb, -5);
  assert.equal(audio.options.lined?.gainDb, -5);
  gains.set(String(ids[1]), -2.5);
  await session.gainsChanged();
  assert.equal(audio.options.lined?.gainDb, -2.5);
  await session.dispatch({ type: "next" });
  assert.equal(audio.options.loaded?.gainDb, -2.5);
});

/** A device whose `load` fails for the paths `broken` names. */
const deviceFailing = (broken: Set<string>) => {
  const audio = device();
  const port: AudioPort = {
    ...audio,
    load: async (path, key, how) => {
      for (const name of broken) if (path.includes(name)) throw new Error("[decode] can't open");
      return audio.load(path, key, how);
    },
  };
  return port;
};

test("Previous with no position goes by the session's own when its turn comes", async (t) => {
  const db = await openTestDatabase();
  const ids = [addTrack(db, { title: "First" }), addTrack(db, { title: "Second" })];
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: ids.map(String),
    context: { kind: "songs", id: null },
  });
  await session.seek(60000);
  const current = () => session.snapshot().queue.entries[session.snapshot().queue.index]?.trackId;
  // Previous is asked while Next still runs: the new song is at its start, so it goes back.
  await Promise.all([session.dispatch({ type: "next" }), session.dispatch({ type: "previous" })]);
  assert.equal(current(), String(ids[0]));
  await session.seek(4000);
  await session.dispatch({ type: "previous" });
  assert.equal(current(), String(ids[0]), "past three seconds it restarts the song");
  assert.equal(session.snapshot().status.positionMs, 0);
  await session.dispatch({ type: "next" });
  await session.seek(4000);
  await session.dispatch({ type: "previous" });
  assert.equal(current(), String(ids[1]));
});

test("a new queue whose song won't load still replaces the old one, stopped, with Undo", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const b = addTrack(db, { title: "Broken" });
  const broken = new Set(["Broken"]);
  let changes = 0;
  const session = await createPlaybackSession({
    db,
    audio: deviceFailing(broken),
    source: "desktop",
    changed: () => changes++,
  });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(a)],
    context: { kind: "songs", id: null },
  });
  await session.seek(12000);
  const before = changes;
  await assert.rejects(
    session.dispatch({ type: "play", trackIds: [String(b)], context: { kind: "songs", id: null } }),
    /decode/,
  );
  const failed = session.snapshot();
  assert.deepEqual(
    failed.queue.entries.map((entry) => entry.trackId),
    [String(b)],
  );
  assert.equal(failed.status.state, "idle", "the old song doesn't play on under the new queue");
  assert.equal(failed.status.key, undefined);
  assert.equal(failed.canUndo, true);
  assert.ok(changes > before, "the change is told");
  // Play tries the queue's song again instead of resuming the one the audio process still holds.
  await assert.rejects(session.play(), /decode/);
  broken.clear();
  await session.play();
  assert.equal(session.snapshot().status.state, "playing");
  assert.equal(session.snapshot().status.key, session.snapshot().queue.entries[0]?.key);
  await session.undo();
  assert.equal(session.snapshot().queue.entries[0]?.trackId, String(a));
  assert.equal(session.snapshot().status.positionMs, 12000);
});

test("Undo to a song that won't load goes back to the old queue, stopped", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "Broken" });
  const b = addTrack(db, { title: "Second" });
  const broken = new Set<string>();
  let changes = 0;
  const session = await createPlaybackSession({
    db,
    audio: deviceFailing(broken),
    source: "desktop",
    changed: () => changes++,
  });
  t.after(() => session.close());
  for (const id of [a, b])
    await session.dispatch({
      type: "play",
      trackIds: [String(id)],
      context: { kind: "songs", id: null },
    });
  broken.add("Broken");
  const before = changes;
  await assert.rejects(session.undo(), /decode/);
  const undone = session.snapshot();
  assert.equal(undone.queue.entries[0]?.trackId, String(a));
  assert.equal(undone.status.state, "idle");
  assert.equal(undone.canUndo, false);
  assert.ok(changes > before, "the change is told");
});

test("a Recap's music plays in place of the queue, counts no play, and gives the queue back paused where it was", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const b = addTrack(db, { title: "Second" });
  const top = addTrack(db, { title: "Top Song" });
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
    startIndex: 1,
    context: { kind: "album", id: "1" },
  });
  await session.seek(12000);
  await session.pause();
  const playsBefore = db.select().from(playEvents).all().length;

  const loan = await session.borrow();
  await loan.play(String(top));
  assert.deepEqual(
    session.snapshot().queue.entries.map((entry) => entry.trackId),
    [String(top)],
  );
  assert.equal(session.snapshot().status.state, "playing");
  assert.equal(session.snapshot().canUndo, false, "a Recap's music offers no Undo");
  now += 60000;
  await session.flush();
  // Quitting mid-Recap must find the owner's queue, not the Recap's song.
  assert.deepEqual(
    savedQueueState(loadPlayback(db)!.parts)?.entries.map((entry) => entry.trackId),
    [String(a), String(b)],
  );
  assert.equal(loadPlayback(db)!.positionMs, 12000);

  await loan.giveBack();
  const { queue, status } = session.snapshot();
  assert.deepEqual(
    queue.entries.map((entry) => entry.trackId),
    [String(a), String(b)],
  );
  assert.equal(queue.index, 1);
  assert.equal(status.state, "paused");
  assert.equal(status.positionMs, 12000);
  assert.equal(db.select().from(playEvents).all().length, playsBefore, "no play was recorded");
  assert.equal(
    homePlays(db)
      .mostPlayed.map(libraryRow)
      .some((row) => row.id === top),
    false,
  );
});

test("turning Don't play explicit on during a Recap removes explicit songs from the queue it gives back", async (t) => {
  const db = await openTestDatabase();
  const explicit = addTrack(db, { title: "Explicit", explicit: "explicit" });
  const clean = addTrack(db, { title: "Clean" });
  const top = addTrack(db, { title: "Recap song" });
  let on = false;
  const session = await createPlaybackSession({
    db,
    audio: device(),
    source: "desktop",
    dontPlayExplicit: () => on,
  });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: [String(explicit), String(clean), String(explicit)],
    context: { kind: "album", id: "1" },
  });
  await session.seek(12000);
  await session.pause();

  const loan = await session.borrow();
  await loan.play(String(top));
  on = true;
  await session.dropExplicit();
  assert.equal(session.snapshot().queue.entries[0]?.trackId, String(top));
  const saved = loadPlayback(db)!;
  on = false;
  await loan.giveBack();

  const { queue, status } = session.snapshot();
  assert.deepEqual(
    queue.entries.map((entry) => entry.trackId),
    [String(clean)],
  );
  assert.equal(queue.index, 0);
  assert.equal(status.state, "paused");
  assert.equal(status.positionMs, 0);
  assert.deepEqual(
    savedQueueState(saved.parts)?.entries.map((entry) => entry.trackId),
    [String(clean)],
  );
  assert.equal(saved.positionMs, 0);
});

test("a queue played during a Recap stays when the Recap closes", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "First" });
  const top = addTrack(db, { title: "Top Song" });
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  const loan = await session.borrow();
  await loan.play(String(top));
  await session.dispatch({
    type: "play",
    trackIds: [String(a)],
    context: { kind: "songs", id: null },
  });
  await loan.giveBack();
  assert.deepEqual(
    session.snapshot().queue.entries.map((entry) => entry.trackId),
    [String(a)],
  );
  assert.equal(session.snapshot().status.state, "playing");
});

test("a Recap opened over an empty queue leaves it empty and silent when it closes", async (t) => {
  const db = await openTestDatabase();
  const top = addTrack(db, { title: "Top Song" });
  const session = await createPlaybackSession({ db, audio: device(), source: "desktop" });
  t.after(() => session.close());
  const loan = await session.borrow();
  await loan.play(String(top));
  await loan.giveBack();
  assert.equal(session.snapshot().queue.entries.length, 0);
  assert.notEqual(session.snapshot().status.state, "playing");
});

test("a file outside the Library plays from its path between Library songs and records no play", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "Library" });
  const loaded: string[] = [];
  const preloaded: (string | undefined)[] = [];
  const audio = device();
  let now = 1000;
  const ended: string[] = [];
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
    openedFile: (path) => path !== "/gone/Deleted.mp3",
    playEnded: (play) => ended.push(play.trackId),
  });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: ["file:/tmp/Outside.mp3", "file:/gone/Deleted.mp3", String(a)],
    context: { kind: "files", id: null },
  });
  assert.deepEqual(loaded, ["/tmp/Outside.mp3"]);
  assert.match(String(preloaded.at(-1)), /Library\.mp3$/, "a file that is gone is skipped");
  await session.play();
  now += 40000;
  await session.dispatch({ type: "next" });
  assert.equal(db.select().from(playEvents).all().length, 1, "only the Library song has a play");
  assert.equal(db.select().from(playEvents).all()[0]?.trackId, a);
  assert.deepEqual(ended, [], "a play of a file outside the Library isn't told as one to sync");
});

test("without an opened-file reader, a file entry is skipped as unplayable", async (t) => {
  const db = await openTestDatabase();
  const a = addTrack(db, { title: "Library" });
  const session = await createPlaybackSession({ db, audio: device(), source: "phone" });
  t.after(() => session.close());
  await session.dispatch({
    type: "play",
    trackIds: ["file:/tmp/Outside.mp3", String(a)],
    context: { kind: "files", id: null },
  });
  const { queue } = session.snapshot();
  assert.equal(queue.entries[queue.index]?.trackId, String(a));
});

test("with Don't play explicit on, explicit Library and YT Music songs stay out of the queue, and turning it on takes them out", async (t) => {
  const db = await openTestDatabase();
  const clean = addTrack(db, { title: "Clean" });
  const explicit = addTrack(db, { title: "Explicit", explicit: "explicit" });
  const unknown = addTrack(db, { title: "Unknown" });
  const streamed = (videoId: string, isExplicit: boolean) => ({
    videoId,
    title: videoId,
    artists: ["Someone"],
    album: null,
    albumId: null,
    durationMs: 60000,
    artworkUrl: null,
    explicit: isExplicit,
  });
  const songs = [streamed("cleanstream", false), streamed("explicitone", true)];
  let on = true;
  const session = await createPlaybackSession({
    db,
    audio: device(),
    source: "desktop",
    streamed: (videoId) => songs.find((song) => song.videoId === videoId),
    dontPlayExplicit: () => on,
  });
  t.after(() => session.close());
  const queued = () => session.snapshot().queue.entries.map((entry) => entry.trackId);
  const current = () => {
    const { queue } = session.snapshot();
    return queue.entries[queue.index]?.trackId;
  };
  const all = [
    String(explicit),
    String(clean),
    "yt:explicitone",
    "yt:cleanstream",
    String(unknown),
  ];
  const play = { type: "play", trackIds: all, context: { kind: "songs", id: null } } as const;

  // The tapped explicit song gives way to the next clean one; a song nothing says about plays.
  await session.dispatch({ ...play, startIndex: 0 });
  assert.deepEqual(queued(), [String(clean), "yt:cleanstream", String(unknown)]);
  assert.equal(current(), String(clean));
  await session.dispatch({ type: "addToQueue", trackIds: ["yt:explicitone", String(explicit)] });
  assert.deepEqual(queued(), [String(clean), "yt:cleanstream", String(unknown)]);

  on = false;
  await session.dispatch({ ...play, startIndex: 2 });
  assert.deepEqual(queued(), all);
  assert.equal(current(), "yt:explicitone");
  assert.equal(session.snapshot().status.state, "playing");

  // The switch turns on: the queue's explicit songs go, the playing one too.
  on = true;
  await session.dropExplicit();
  assert.deepEqual(queued(), [String(clean), "yt:cleanstream", String(unknown)]);
  assert.equal(current(), "yt:cleanstream");
  assert.equal(session.snapshot().status.state, "playing");
});
