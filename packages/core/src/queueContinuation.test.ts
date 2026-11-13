import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  RECAP_PLAY_CONTEXT,
  queueContinuation,
  reduceQueue,
  queueWrite,
  savedQueueState,
  startMagicQueue,
  continueMagicQueue,
  completeMagicRadioBatch,
  rankRadioSongs,
  magicArtistKey,
  availableMagicSongs,
  parseMagicSession,
  magicPickDue,
  queueUndo,
} from "./index.ts";

test("an album continues from its album when its last song starts", () => {
  const album = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1", "2"],
    context: { kind: "album", id: "7" },
  }).state;
  assert.equal(queueContinuation(album), null);
  const last = reduceQueue(album, { type: "next" }).state;
  assert.deepEqual(queueContinuation(last), { kind: "album", id: "7" });
});

test("restored playlists and artists keep their seed even with a hand-added last song; loose songs use that song", () => {
  for (const kind of ["playlist", "artist", "songs", "search"] as const) {
    let state = reduceQueue(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["1"],
      context: { kind, id: "42" },
    }).state;
    state = reduceQueue(state, { type: "addToQueue", trackIds: ["yt:last"] }).state;
    assert.equal(queueContinuation(state), null);
    state = reduceQueue(state, { type: "next" }).state;
    const write = queueWrite(null, { state, positionMs: 1234 });
    const restored = savedQueueState({
      queue: write.queue!,
      metadata: write.metadata!,
      index: write.index!,
    })!;
    assert.deepEqual(
      queueContinuation(restored),
      kind === "playlist" || kind === "artist"
        ? { kind, id: "42" }
        : { kind: "track", id: "yt:last" },
    );
  }
});

test("continuing preserves the queue and appends ten fresh songs through the ordinary Magic Queue batch", () => {
  let state = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1", "2"],
    startIndex: 1,
    context: { kind: "album", id: "7" },
  }).state;
  const seed = { kind: "album", id: "7", title: "Album" } as const;
  const song = (trackId: string) => ({
    trackId,
    artists: [magicArtistKey("Artist")],
    genre: null,
    style: null,
  });
  const started = startMagicQueue(seed, [song("1"), song("2")], {
    id: "session",
    random: () => 0,
  })!;
  const session = parseMagicSession(
    JSON.parse(JSON.stringify(continueMagicQueue(started.session, state))),
  )!;
  assert.equal(session.faithful, true);
  const command = {
    type: "continueMagicQueue",
    sessionId: session.id,
    from: state,
  } as const;
  const continued = reduceQueue(state, command);
  assert.equal(continued.playback, "keep");
  assert.equal(continued.state.entries, state.entries);
  assert.equal(continued.state.index, 1);
  assert.deepEqual(continued.state.context, { kind: MAGIC_QUEUE_CONTEXT, id: "session" });
  assert.equal(queueUndo(state, command, { key: state.entries[1]!.key, positionMs: 15_000 }), null);
  assert.equal(magicPickDue(session, null, continued.state, { type: "endOfQueue" }), false);
  for (const repeat of ["all", "one"] as const)
    assert.equal(magicPickDue(session, null, { ...continued.state, repeat }), false);
  const candidates = rankRadioSongs(
    { artists: ["Artist"] },
    {
      pages: [],
      library: Array.from({ length: 24 }, (_, i) => song(String(i + 1))),
    },
  );
  const batch = completeMagicRadioBatch(session, candidates, []);
  assert.deepEqual(batch.trackIds, ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  state = reduceQueue(continued.state, { type: "append", trackIds: batch.trackIds }).state;
  assert.equal(state.entries[1]?.trackId, "2");
  assert.equal(state.entries.length, 12);
  assert.equal(queueContinuation(state), null);
  state = reduceQueue(state, { type: "jumpTo", key: state.entries.at(-1)!.key }).state;
  assert.equal(magicPickDue(batch.session, null, state), true);
  assert.deepEqual(completeMagicRadioBatch(batch.session, candidates, []).trackIds, [
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "21",
    "22",
  ]);
});

test("a pending continuation cannot take over a queue edited or replaced while its seed was read", () => {
  const from = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1"],
    context: { kind: "songs", id: null },
  }).state;
  const command = { type: "continueMagicQueue", sessionId: "session", from } as const;
  for (const state of [
    reduceQueue(from, { type: "setRepeat", mode: "all" }).state,
    reduceQueue(from, { type: "addToQueue", trackIds: ["2"] }).state,
    reduceQueue(from, { type: "play", trackIds: ["3"], context: { kind: "songs", id: null } })
      .state,
  ])
    assert.equal(reduceQueue(state, command).state, state);
});

test("repeat, a sleep timer, disabled continuation and an existing Magic Queue take precedence", () => {
  const last = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1"],
    context: { kind: "songs", id: null },
  }).state;
  for (const repeat of ["one", "all"] as const)
    assert.equal(queueContinuation({ ...last, repeat }), null);
  assert.equal(queueContinuation(last, { enabled: false }), null);
  assert.equal(queueContinuation(last, { sleepTimer: { type: "endOfQueue" } }), null);
  assert.equal(queueContinuation(last, { sleepTimer: { type: "endOfTrack" } }), null);
  assert.equal(
    queueContinuation({ ...last, context: { kind: MAGIC_QUEUE_CONTEXT, id: "session" } }),
    null,
  );
  assert.equal(queueContinuation(EMPTY_QUEUE), null);
  assert.equal(queueContinuation({ ...last, context: RECAP_PLAY_CONTEXT }), null);
});

test("a continuation uses only Library files offline or with YT Music off, then includes streams online", () => {
  const library = { trackId: "1", artists: [magicArtistKey("Artist")], genre: null, style: null };
  const session = startMagicQueue({ kind: "track", id: "1", title: "Song" }, [library], {
    id: "session",
    random: () => 0,
  })!.session;
  const continued = { ...session, continuation: true };
  const ranked = rankRadioSongs(
    { artists: ["Artist"] },
    {
      library: [library],
      pages: [
        {
          id: "radio",
          artists: ["Artist"],
          songs: [
            {
              videoId: "cached",
              title: "Stream",
              artists: ["Artist"],
              album: null,
              albumId: null,
              durationMs: 180_000,
              artworkUrl: null,
              explicit: false,
            },
          ],
        },
      ],
    },
  );
  const options = { online: false, ytMusic: true, cachedVideos: new Set(["cached"]) };
  assert.deepEqual(
    availableMagicSongs(continued, ranked, options).map((s) => s.trackId),
    ["1"],
  );
  assert.deepEqual(
    availableMagicSongs(continued, ranked, { ...options, online: true, ytMusic: false }).map(
      (s) => s.trackId,
    ),
    ["1"],
  );
  assert.deepEqual(
    availableMagicSongs(continued, ranked, { ...options, online: true }).map((s) => s.trackId),
    ["yt:cached", "1"],
  );
  assert.deepEqual(
    availableMagicSongs(session, ranked, options).map((s) => s.trackId),
    ["yt:cached", "1"],
  );
});

test("without radios a continuation can draw from other Library artists, still learning from its signals", () => {
  const song = (trackId: string, name: string) => ({
    trackId,
    artists: [magicArtistKey(name)],
    genre: "rock",
    style: null,
  });
  const ranked = rankRadioSongs(
    { artists: ["Seed"] },
    {
      pages: [],
      library: [song("2", "Skipped"), song("3", "Liked"), song("4", "Other")],
      signals: [
        { kind: "skip", song: song("1", "Skipped") },
        { kind: "favorite", song: song("5", "Liked") },
      ],
    },
    { libraryFallback: true },
  );
  assert.deepEqual(
    ranked.map((candidate) => candidate.trackId),
    ["3", "4", "2"],
  );
});
