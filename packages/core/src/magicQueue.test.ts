import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  radioRankingBatch,
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  genreProfile,
  magicArtistKey,
  magicBatchEmpty,
  magicBatchFailed,
  magicBatchLoading,
  magicPickDue,
  magicQueueFootnote,
  magicPickEnded,
  magicBatchRadios,
  magicLibrarySongs,
  magicSeedProfile,
  magicFaithfulGenreProfile,
  magicYtSong,
  magicRadioArtists,
  magicQueueEdits,
  magicQueueLabel,
  magicQueueKeepsPlayingSong,
  magicQueueShare,
  magicSignal,
  magicPlaySignal,
  parseMagicSession,
  reduceQueue,
  startMagicQueue,
  startStreamedMagicQueue,
  searchSongTap,
  streamedSongMagicStart,
  wantsMagicBatch,
  type DiscoverMixLevel,
  type GenreProfileOf,
  type MagicSeed,
  type MagicSession,
  type MagicSignalKind,
  type MagicSong,
  type QueueCommand,
  type QueueState,
} from "./index.ts";

/** The luckiest draw: each pick lands on the heaviest song left. */
const first = () => 0;

const song = (trackId: string, artist: string, genre: string | null = "Rock"): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre,
  style: null,
});

const SONG_SEED: MagicSeed = { kind: "track", id: "s1", title: "Seed Song" };

/** [count] songs by [artist], ids `<prefix>1`, `<prefix>2`… */
const songsBy = (prefix: string, artist: string, count: number, genre = "Rock"): MagicSong[] =>
  Array.from({ length: count }, (_, i) => song(`${prefix}${i + 1}`, artist, genre));

describe("Starting a Magic Queue", () => {
  test("keeps only a seed with the playing track's exact id", () => {
    assert.equal(magicQueueKeepsPlayingSong("track-1", "track-1"), true);
    assert.equal(magicQueueKeepsPlayingSong("track-1", "track-2"), false);
    assert.equal(magicQueueKeepsPlayingSong("track-1", null), false);
  });

  test("keeps the playing recording across sources by video id or recording key", () => {
    assert.equal(
      magicQueueKeepsPlayingSong(
        { trackId: "12", videoId: "video", recordingKey: "album\u001fsong" },
        { trackId: "yt:video", videoId: "video" },
      ),
      true,
    );
    assert.equal(
      magicQueueKeepsPlayingSong(
        { trackId: "yt:video", videoId: "video" },
        { trackId: "12", videoId: "video", recordingKey: "album\u001fsong" },
      ),
      true,
    );
    assert.equal(
      magicQueueKeepsPlayingSong(
        { trackId: "12", recordingKey: "album\u001fsong" },
        { trackId: "13", recordingKey: "album\u001flive" },
      ),
      false,
    );
    assert.equal(
      magicQueueKeepsPlayingSong(
        {
          trackId: "yt:video",
          recording: { title: "Midnight City", artists: ["M83"], durationMs: 244_000 },
        },
        {
          trackId: "12",
          recording: { title: "Midnight City", artists: ["M83"], durationMs: 245_000 },
        },
      ),
      true,
    );
    assert.equal(
      magicQueueKeepsPlayingSong(
        {
          trackId: "yt:video",
          recording: { title: "Midnight City (Live)", artists: ["M83"], durationMs: 244_000 },
        },
        {
          trackId: "12",
          recording: { title: "Midnight City", artists: ["M83"], durationMs: 244_000 },
        },
      ),
      false,
    );
  });

  test("faithfulness survives saving while older and ordinary sessions remain unfaithful", () => {
    const seed = song("s1", "Seed Artist");
    const ordinary = startMagicQueue(SONG_SEED, [seed], { id: "ordinary", random: first })!.session;
    const faithful = startMagicQueue(SONG_SEED, [seed], {
      id: "search",
      random: first,
      faithful: true,
    })!.session;
    assert.equal(ordinary.faithful, undefined);
    assert.equal(parseMagicSession(JSON.parse(JSON.stringify(faithful)))?.faithful, true);
    const old = { ...faithful };
    delete (old as { faithful?: boolean }).faithful;
    assert.equal(parseMagicSession(old)?.faithful, undefined);
  });
  test("a song played from Search or a link is headed Related, in both languages", () => {
    const { session } = startMagicQueue(SONG_SEED, [song("s1", "Seed Artist")], {
      id: "search",
      random: first,
      faithful: true,
      plainPlay: true,
    })!;
    assert.equal(magicQueueLabel(session), "Related · from Seed Song");
    assert.equal(magicQueueLabel(session, catalogueOf("pt-BR")), "Relacionadas · de Seed Song");
  });

  test("a streamed song played from Search or a link is headed Related too", () => {
    const { session } = startStreamedMagicQueue(
      {
        videoId: "vid1",
        title: "Midnight City",
        artists: ["M83"],
        album: null,
        durationMs: 244_000,
        artworkUrl: null,
        explicit: false,
      },
      { id: "link", plainPlay: true },
    );
    assert.equal(magicQueueLabel(session), "Related · from Midnight City");
    assert.equal(magicQueueLabel(session, catalogueOf("pt-BR")), "Relacionadas · de Midnight City");
  });

  test("the Related heading survives saving; a session saved before it keeps Magic Queue", () => {
    const { session } = startMagicQueue(SONG_SEED, [song("s1", "Seed Artist")], {
      id: "search",
      random: first,
      faithful: true,
      plainPlay: true,
    })!;
    const saved = JSON.parse(JSON.stringify(session)) as Record<string, unknown>;
    assert.equal(magicQueueLabel(parseMagicSession(saved)!), "Related · from Seed Song");
    // Faithful sessions saved before the mark came from Search too, and can't be told apart.
    delete saved["plainPlay"];
    assert.equal(magicQueueLabel(parseMagicSession(saved)!), "Magic Queue · from Seed Song");
  });

  test("a Magic Queue the owner asked for, or a continuation, keeps its heading", () => {
    const seed = song("s1", "Seed Artist");
    const asked = startMagicQueue(SONG_SEED, [seed], { id: "menu", random: first })!.session;
    assert.equal(magicQueueLabel(asked), "Magic Queue · from Seed Song");
    // A continuation is faithful, as a Search tap is, yet the owner's setting asked for it.
    const continued = startMagicQueue(SONG_SEED, [seed], {
      id: "continued",
      random: first,
      faithful: true,
    })!.session;
    assert.equal(magicQueueLabel(continued), "Magic Queue · from Seed Song");
    assert.equal(
      magicQueueLabel(parseMagicSession(JSON.parse(JSON.stringify(continued)))!),
      "Magic Queue · from Seed Song",
    );
  });

  test("a faithful list seed keeps families at 10% of songs with known genres", () => {
    const profile = genreProfile([
      ...Array.from({ length: 9 }, () => ({ genre: "Rock" })),
      { genre: "Jazz" },
      { genre: null },
    ]);
    const started = startMagicQueue(
      { kind: "playlist", id: "list", title: "List" },
      [song("s1", "Seed Artist")],
      {
        id: "faithful-list",
        random: first,
        faithful: true,
        radio: { artists: ["Seed Artist"], profile },
      },
    )!.session;
    assert.deepEqual(
      [...magicFaithfulGenreProfile(started)!],
      [
        ["rock", 0.9],
        ["jazz", 0.1],
      ],
    );
    const below = { ...started, seedProfile: { rock: 0.91, jazz: 0.09 } };
    assert.deepEqual([...magicFaithfulGenreProfile(below)!], [["rock", 0.91]]);
  });
  test("faithful song and artist seeds keep their full genre profile", () => {
    const profile = new Map([
      ["rock", 0.91],
      ["jazz", 0.09],
    ]);
    for (const seed of [SONG_SEED, { kind: "artist" as const, id: "artist", title: "Artist" }]) {
      const started = startMagicQueue(seed, [song("s1", "Seed Artist")], {
        id: `faithful-${seed.kind}`,
        random: first,
        faithful: true,
        radio: { artists: ["Seed Artist"], profile },
      })!.session;
      assert.deepEqual([...magicFaithfulGenreProfile(started)!], [...profile]);
    }
  });
  test("a faithful list with no known genres has a neutral genre profile", () => {
    const started = startMagicQueue(
      { kind: "list", id: "mix", title: "Discover mix" },
      [song("s1", "Seed Artist", null)],
      {
        id: "faithful-unknown-list",
        random: first,
        faithful: true,
        radio: { artists: ["Seed Artist"], profile: null },
      },
    )!.session;
    assert.equal(magicFaithfulGenreProfile(started), null);
  });
  test("new sessions and signals omit retired weights while old sessions still load", () => {
    const started = startMagicQueue(SONG_SEED, [song("s1", "Seed Artist")], {
      id: "m1",
      random: first,
    })!.session;
    assert.ok(!("artistAffinity" in started));
    assert.ok(!("genreAffinity" in started));
    assert.ok(!("excludedArtists" in started));
    const old = parseMagicSession({
      ...started,
      artistAffinity: { old: 3 },
      genreAffinity: { rock: 2 },
      excludedArtists: ["old"],
    })!;
    for (const kind of [
      "skip",
      "removed",
      "favorite",
      "download",
      "playedThrough",
      "added",
    ] as const) {
      const learned = magicSignal(old, { kind, song: song("new", "New Artist") });
      assert.ok(!("artistAffinity" in learned));
      assert.ok(!("genreAffinity" in learned));
      assert.ok(!("excludedArtists" in learned));
      assert.equal(learned.radioSignals?.[0]?.kind, kind);
      assert.ok(learned.used.includes("new"));
    }
  });
  test("plays the song itself for a song seed", () => {
    const seed = song("s1", "Seed Artist");
    const started = startMagicQueue(SONG_SEED, [seed], { id: "m1", random: first });
    assert.equal(started?.first, "s1");
  });

  test("plays a random song of a playlist, album or artist seed", () => {
    const songs = songsBy("a", "Artist", 4);
    const seed: MagicSeed = { kind: "album", id: "7", title: "An Album" };
    assert.equal(startMagicQueue(seed, songs, { id: "m1", random: () => 0.6 })?.first, "a3");
  });

  test("can't start from a seed with no songs", () => {
    const seed: MagicSeed = { kind: "playlist", id: "3", title: "Empty" };
    assert.equal(startMagicQueue(seed, [], { id: "m1", random: first }), null);
  });
});

/** What a play's end tells a Magic Queue: ended for [endReason] after [listenedMs], by Next or not. */
const ended = (
  endReason: "completed" | "skipped" | "stopped" | "interrupted",
  listenedMs: number,
  byNext = false,
) => magicPlaySignal({ play: { endReason, listenedMs }, byNext });

describe("How a play ends, as a Magic Queue signal", () => {
  test("Next within the first 30 s is a skip", () => {
    assert.equal(ended("skipped", 29_999, true), "skip");
  });

  test("Next after 30 s is neutral", () => {
    assert.equal(ended("skipped", 30_000, true), null);
  });

  test("Previous, picking another Up Next entry or a replay within 30 s is neutral", () => {
    assert.equal(ended("skipped", 5_000), null);
  });

  test("played to the end is positive", () => {
    assert.equal(ended("completed", 200_000), "playedThrough");
  });

  test("stopped or interrupted says nothing", () => {
    assert.equal(ended("stopped", 1_000, true), null);
    assert.equal(ended("interrupted", 1_000), null);
  });
});

describe("A Magic Queue's songs from both sources", () => {
  const artists = [
    { id: 1, name: "Seed Artist" },
    { id: 2, name: "Paramore" },
    { id: 3, name: "Popper" },
    { id: 4, name: "Metaller" },
  ];
  const fromLibrary = magicLibrarySongs(artists);
  const metal = genreProfile([{ genre: "Metal" }]);
  const profileOf: GenreProfileOf = (artist) => (artist === "Deezer Band" ? metal : undefined);

  test("a Library song weighs by its artists' names and its genre family", () => {
    const one = fromLibrary({ id: 11, artistIds: [2, 1], genre: "Alt Rock" });
    assert.deepEqual(one, {
      trackId: "11",
      artists: [magicArtistKey("Paramore"), magicArtistKey("Seed Artist")],
      genre: genreProfile([{ genre: "Alt Rock" }])!
        .keys()
        .next().value,
      style: null,
    });
  });

  test("a YouTube Music song's genre comes from its artist's Deezer profile", () => {
    const deezer = magicYtSong({ trackId: "yt:d", artists: ["Nobody", "Deezer Band"] }, profileOf);
    assert.equal(deezer.genre, metal!.keys().next().value);
    assert.equal(magicYtSong({ trackId: "yt:n", artists: ["Nobody"] }, profileOf).genre, null);
  });
});

describe("A Magic Queue in the queue", () => {
  const session: MagicSession = startMagicQueue(SONG_SEED, [song("s1", "Seed Artist")], {
    id: "m1",
    random: first,
  })!.session;
  const context = { kind: MAGIC_QUEUE_CONTEXT, id: "m1" };
  const run = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
    commands.reduce((current, command) => reduceQueue(current, command).state, state);
  const show = (state: QueueState): string =>
    state.entries
      .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
      .join(" ");
  const playing = run(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["s1", "a", "b"],
    startIndex: 0,
    context,
  });
  const keyOf = (state: QueueState, trackId: string): string =>
    state.entries.find((entry) => entry.trackId === trackId)!.key;

  test("a batch joins the end of the queue, after songs lined up", () => {
    const state = run(
      playing,
      { type: "addToQueue", trackIds: ["q"] },
      { type: "append", trackIds: ["c", "d"] },
    );
    assert.equal(show(state), "[s1] q a b c d");
  });

  test("wants a batch while two recommendations are left in Up Next, not three", () => {
    const three = run(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["s1", "a", "b", "c"],
      startIndex: 0,
      context,
    });
    assert.equal(wantsMagicBatch(session, three), false);
    const two = run(three, { type: "next" });
    assert.equal(wantsMagicBatch(session, two), true);
    const last = run(two, { type: "next" }, { type: "next" });
    assert.equal(wantsMagicBatch(session, last), true);
    // Songs lined up by hand don't hold the batch back.
    assert.equal(
      wantsMagicBatch(session, run(two, { type: "playNext", trackIds: ["q", "r", "t"] })),
      true,
    );
  });

  test("wants a batch sooner when the recommendations left play for under eight minutes", () => {
    const three = run(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["s1", "a", "b", "c"],
      startIndex: 0,
      context,
    });
    const minutes = (lengths: Record<string, number>) => (trackId: string) =>
      trackId in lengths ? lengths[trackId]! * 60_000 : null;
    assert.equal(wantsMagicBatch(session, three, null, minutes({ a: 2, b: 2, c: 2 })), true);
    assert.equal(wantsMagicBatch(session, three, null, minutes({ a: 2, b: 3, c: 3 })), false);
    // A song of unknown length counts as a typical song of three and a half minutes.
    assert.equal(wantsMagicBatch(session, three, null, minutes({})), false);
    assert.equal(wantsMagicBatch(session, three, null, minutes({ a: 1, b: 1 })), true);
    // The song playing doesn't count, however long.
    assert.equal(
      wantsMagicBatch(session, three, null, minutes({ s1: 1, a: 3, b: 3, c: 3 })),
      false,
    );
    // Nor do songs lined up by hand.
    const lined = run(three, { type: "playNext", trackIds: ["q"] });
    assert.equal(wantsMagicBatch(session, lined, null, minutes({ q: 30, a: 2, b: 2, c: 2 })), true);
  });

  test("is over once something else plays", () => {
    const other = run(playing, {
      type: "play",
      trackIds: ["x", "y"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(wantsMagicBatch(session, run(other, { type: "next" })), false);
    assert.deepEqual(magicQueueEdits(session, playing, other), { added: [], removed: [] });
  });

  test("tells songs lined up by hand apart from its own batches", () => {
    const lined = run(playing, { type: "playNext", trackIds: ["q"] });
    assert.deepEqual(magicQueueEdits(session, playing, lined), { added: ["q"], removed: [] });
    const batched = run(playing, { type: "append", trackIds: ["c"] });
    assert.deepEqual(magicQueueEdits(session, playing, batched), { added: [], removed: [] });
  });

  test("tells a removed recommendation apart from a song lined up by hand and removed", () => {
    const lined = run(playing, { type: "playNext", trackIds: ["q"] });
    const noA = run(lined, { type: "remove", key: keyOf(lined, "a") });
    assert.deepEqual(magicQueueEdits(session, lined, noA), { added: [], removed: ["a"] });
    const noQ = run(lined, { type: "remove", key: keyOf(lined, "q") });
    assert.deepEqual(magicQueueEdits(session, lined, noQ), { added: [], removed: [] });
    // Playing on past a song is no removal.
    assert.deepEqual(magicQueueEdits(session, lined, run(lined, { type: "next" })), {
      added: [],
      removed: [],
    });
  });

  test("shows its batch loading while it's picked, until the batch lands", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicBatchLoading(session, "m1", seedOnly), true);
    assert.equal(magicBatchLoading(session, null, seedOnly), false);
    // The batch in Up Next takes the loading's place, before the picking is cleared.
    const landed = run(seedOnly, { type: "append", trackIds: ["a", "b", "c"] });
    assert.equal(magicBatchLoading(session, "m1", landed), false);
  });

  test("shows a later batch loading under the songs lined up by hand", () => {
    const last = run(
      playing,
      { type: "next" },
      { type: "next" },
      { type: "addToQueue", trackIds: ["q"] },
    );
    assert.equal(magicBatchLoading(session, "m1", last), true);
  });

  test("shows no batch loading once something else plays, or for another session", () => {
    const last = run(playing, { type: "next" }, { type: "next" });
    const other = run(last, {
      type: "play",
      trackIds: ["x"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicBatchLoading(session, "m1", other), false);
    assert.equal(magicBatchLoading(session, "m0", last), false);
    assert.equal(magicBatchLoading(null, "m1", last), false);
  });

  test("shows its batch failed until the batch lands or something else plays", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicBatchFailed(session, "m1", seedOnly), true);
    assert.equal(magicBatchFailed(session, null, seedOnly), false);
    assert.equal(magicBatchFailed(session, "m0", seedOnly), false);
    const landed = run(seedOnly, { type: "append", trackIds: ["a", "b", "c"] });
    assert.equal(magicBatchFailed(session, "m1", landed), false);
    const other = run(seedOnly, {
      type: "play",
      trackIds: ["x"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicBatchFailed(session, "m1", other), false);
  });

  test("says its batch found no songs until a batch lands or something else plays (#638)", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicBatchEmpty(session, "m1", seedOnly), true);
    assert.equal(magicBatchEmpty(session, null, seedOnly), false);
    assert.equal(magicBatchEmpty(session, "m0", seedOnly), false);
    assert.equal(
      magicBatchEmpty(session, "m1", run(seedOnly, { type: "append", trackIds: ["a", "b", "c"] })),
      false,
    );
    const other = run(seedOnly, {
      type: "play",
      trackIds: ["x"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicBatchEmpty(session, "m1", other), false);
  });

  test("holds its batch back while the sleep timer is End of Queue: no loading, no line, until the timer is off", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    const timer = { type: "endOfQueue" } as const;
    // A batch marked as picked when the session started is not on its way: the queue ends here.
    assert.equal(magicBatchLoading(session, "m1", seedOnly, timer), false);
    assert.equal(magicBatchFailed(session, "m1", seedOnly, timer), false);
    assert.equal(magicBatchEmpty(session, "m1", seedOnly, timer), false);
    assert.equal(magicPickEnded("m0", "m1", session, seedOnly, timer).again, false);
    // Any other timer, or none, leaves the batch wanted.
    for (const other of [null, { type: "endOfTrack" }, { type: "deadline", endsAt: 1 }] as const) {
      assert.equal(magicBatchLoading(session, "m1", seedOnly, other), true);
      assert.equal(magicBatchFailed(session, "m1", seedOnly, other), true);
      assert.equal(magicBatchEmpty(session, "m1", seedOnly, other), true);
      assert.equal(magicPickDue(session, null, seedOnly, other), true);
      assert.equal(magicPickEnded("m0", "m1", session, seedOnly, other).again, true);
    }
  });

  test("its pick and Up Next's loading rows follow the songs' lengths too", () => {
    const three = run(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["s1", "a", "b", "c"],
      startIndex: 0,
      context,
    });
    const short = () => 60_000;
    assert.equal(magicPickDue(session, null, three), false);
    assert.equal(magicPickDue(session, null, three, null, short), true);
    assert.equal(magicBatchLoading(session, "m1", three, null, short), true);
    assert.equal(magicBatchFailed(session, "m1", three, null, short), true);
    assert.equal(magicBatchEmpty(session, "m1", three, null, short), true);
    assert.equal(magicPickEnded("m0", null, session, three, null, short).again, true);
    const none = { picking: "m1", failed: null, empty: null };
    assert.equal(magicQueueFootnote(session, none, three), true);
    assert.equal(magicQueueFootnote(session, none, three, null, short), false);
  });

  test("a footnote sits under its songs once they're loaded (#1376)", () => {
    const none = { picking: null, failed: null, empty: null };
    assert.equal(magicQueueFootnote(session, none, playing), true);
    // Songs lined up by hand count as songs under which it sits.
    const last = run(playing, { type: "next" }, { type: "next" });
    assert.equal(magicQueueFootnote(session, none, last), false);
    assert.equal(
      magicQueueFootnote(session, none, run(last, { type: "addToQueue", trackIds: ["q"] })),
      true,
    );
  });

  test("the footnote gives way to loading rows, a failure or an empty result (#1376)", () => {
    const lined = run(
      playing,
      { type: "next" },
      { type: "next" },
      {
        type: "addToQueue",
        trackIds: ["q"],
      },
    );
    const none = { picking: null, failed: null, empty: null };
    assert.equal(magicQueueFootnote(session, { ...none, picking: "m1" }, lined), false);
    assert.equal(magicQueueFootnote(session, { ...none, failed: "m1" }, lined), false);
    assert.equal(magicQueueFootnote(session, { ...none, empty: "m1" }, lined), false);
    // Another session's marks don't hide it.
    assert.equal(
      magicQueueFootnote(session, { picking: "m0", failed: "m0", empty: "m0" }, lined),
      true,
    );
  });

  test("no footnote once something else plays, or while no batch can come (#1376)", () => {
    const none = { picking: null, failed: null, empty: null };
    const other = run(playing, {
      type: "play",
      trackIds: ["x", "y"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicQueueFootnote(session, none, other), false);
    assert.equal(magicQueueFootnote(null, none, playing), false);
    // An End of Queue sleep timer holds the batches back: no more songs arrive.
    assert.equal(magicQueueFootnote(session, none, playing, { type: "endOfQueue" }), false);
    assert.equal(magicQueueFootnote(session, none, playing, { type: "endOfTrack" }), true);
    // A continuation under Repeat adds no batch.
    const continued: MagicSession = { ...session, continuation: true };
    assert.equal(magicQueueFootnote(continued, none, playing), true);
    assert.equal(
      magicQueueFootnote(continued, none, run(playing, { type: "setRepeat", mode: "all" })),
      false,
    );
  });

  test("Up Next names the seed", () => {
    assert.equal(magicQueueLabel(session), "Magic Queue · from Seed Song");
    assert.equal(
      magicQueueLabel(session, catalogueOf("pt-BR")),
      "Fila Mágica · a partir de Seed Song",
    );
  });

  test("a session reads back as it was saved", () => {
    const learned = magicSignal(session, { kind: "skip", song: song("z", "Zed", "Ska") });
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(learned))), learned);
    assert.equal(parseMagicSession({ id: "m1" }), null);
    assert.equal(parseMagicSession(null), null);
  });

  test("keeps what its YouTube Music radio grows from, through a restart", () => {
    const profile = genreProfile([{ genre: "Metal" }, { genre: "Pop" }]);
    const seed: MagicSeed = { kind: "album", id: "7", title: "An Album" };
    const started = startMagicQueue(seed, [song("a1", "A"), song("a2", "A")], {
      id: "m2",
      random: first,
      radio: { artists: ["A", "A"], profile },
    })!.session;
    assert.deepEqual(started.radioArtists, ["A"]);
    assert.deepEqual(magicSeedProfile(started), profile);
    const read = parseMagicSession(JSON.parse(JSON.stringify(started)))!;
    assert.deepEqual(read, started);
    assert.deepEqual(magicSeedProfile(read), profile);
  });

  test("a session saved before it kept its radio reads back with none", () => {
    const { radioArtists: _artists, seedProfile: _profile, ...older } = session;
    const read = parseMagicSession({ ...older, radioArtists: "A" })!;
    assert.deepEqual(read.radioArtists, []);
    assert.equal(magicSeedProfile(read), null);
  });
});

describe("A Magic Queue's YouTube Music share", () => {
  const seedSong = song("s1", "Seed Artist");
  const library = [seedSong, ...songsBy("x", "Other", 40)];
  const start = () => startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first })!.session;
  const yt = songsBy("yt:v", "Radio Artist", 40);
  /** How many of a 10-song batch (the second) come from YouTube Music. */
  const ytInBatch = (session: MagicSession): number => {
    const ranked = [...library, ...yt].map((candidate) => ({
      ...candidate,
      score: 1,
      radio: null,
      song: null,
      source: candidate.trackId.startsWith("yt:") ? ("stream" as const) : ("library" as const),
    }));
    return radioRankingBatch(ranked, { size: 10, newMusicShare: session.ytShare }).filter(
      (candidate) => candidate.source === "stream",
    ).length;
  };

  test("starts at half the batch", () => {
    assert.equal(ytInBatch(start()), 5);
  });

  /** [session] having learned [kind] about [times] YouTube Music songs by different artists. */
  const learnYt = (session: MagicSession, kind: MagicSignalKind, times: number): MagicSession =>
    Array.from({ length: times }, (_, i) => song(`yt:s${i}`, `Learned ${i}`)).reduce(
      (learned, ytSong) => magicSignal(learned, { kind, song: ytSong }),
      session,
    );

  test("grows as YouTube Music songs get favorited or downloaded", () => {
    const favorited = ytInBatch(learnYt(start(), "favorite", 1));
    const downloaded = ytInBatch(learnYt(start(), "download", 1));
    assert.ok(favorited > 5);
    assert.ok(downloaded > 5);
    assert.ok(favorited >= downloaded);
  });

  test("shrinks as YouTube Music songs get skipped or removed", () => {
    assert.ok(ytInBatch(learnYt(start(), "skip", 1)) < 5);
    assert.ok(ytInBatch(learnYt(start(), "removed", 1)) < 5);
  });

  test("starts at the share its new-music level gives, from 20% to 100%", () => {
    const at = (level: DiscoverMixLevel) =>
      startMagicQueue(SONG_SEED, [seedSong], {
        id: "m1",
        random: first,
        ytShare: magicQueueShare(level),
      })!.session;
    assert.deepEqual(
      ([1, 2, 3, 4, 5] as const).map((level) => ytInBatch(at(level))),
      [2, 4, 6, 8, 10],
    );
  });

  test("a share outside 20-100% starts at the nearest bound", () => {
    const at = (ytShare: number) =>
      startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first, ytShare })!.session;
    assert.equal(ytInBatch(at(1.5)), 10);
    assert.equal(ytInBatch(at(0)), 2);
  });

  test("signals keep moving a level's share within 20-100%", () => {
    const high = startMagicQueue(SONG_SEED, [seedSong], {
      id: "m1",
      random: first,
      ytShare: magicQueueShare(5),
    })!.session;
    assert.equal(ytInBatch(learnYt(high, "favorite", 3)), 10);
    assert.ok(ytInBatch(learnYt(high, "skip", 1)) < 10);
  });

  test("always stays between 20% and 100%", () => {
    assert.equal(ytInBatch(learnYt(start(), "favorite", 30)), 10);
    assert.equal(ytInBatch(learnYt(start(), "skip", 30)), 2);
  });

  test("doesn't move with Library songs' signals, or YouTube Music songs played or added", () => {
    let session = start();
    session = magicSignal(session, { kind: "favorite", song: song("x1", "Other") });
    session = magicSignal(session, { kind: "skip", song: song("x2", "Someone") });
    session = learnYt(session, "playedThrough", 3);
    session = learnYt(session, "added", 3);
    assert.equal(session.ytShare, start().ytShare);
  });

  test("reads back as it was saved, and afresh from a session saved before it", () => {
    const learned = learnYt(start(), "favorite", 2);
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(learned))), learned);
    const { ytShare: _, ...older } = learned;
    assert.equal(parseMagicSession(older)?.ytShare, 0.5);
  });
});

describe("A Magic Queue's radio artists", () => {
  test("come from the radio of the seed's artist, or its songs' most credited artists", () => {
    const artistSeed: MagicSeed = { kind: "artist", id: "4", title: "The Seed" };
    assert.deepEqual(magicRadioArtists(artistSeed, ["Someone"]), ["The Seed"]);
    const playlist: MagicSeed = { kind: "playlist", id: "2", title: "Mine" };
    assert.deepEqual(magicRadioArtists(playlist, ["B", "A", "C", "A", "B", "A"]), ["A", "B"]);
    assert.deepEqual(magicRadioArtists(SONG_SEED, ["Solo"]), ["Solo"]);
  });
});

describe("a Magic Queue from a streamed song", () => {
  const streamed = {
    videoId: "vid1",
    title: "Midnight City",
    artists: ["M83", "Anthony Gonzalez"],
    album: "Hurry Up, We're Dreaming",
    durationMs: 244_000,
    artworkUrl: null,
    explicit: false,
  };

  test("plays the song first and grows from its own radio, read by its video", () => {
    const { session, first: firstSong } = startStreamedMagicQueue(streamed, {
      id: "s1",
      ytShare: 0.6,
    });
    assert.equal(firstSong, "yt:vid1");
    assert.deepEqual(session.used, ["yt:vid1"]);
    assert.equal(magicQueueLabel(session), "Magic Queue · from Midnight City");
    assert.equal(session.ytShare, 0.6);
    assert.deepEqual(session.radioArtists, ["M83", "Anthony Gonzalez"]);
    assert.deepEqual(session.seedVideoIds, ["vid1"]);
    // Each batch reads the song's radio, as a Library song's session does.
    assert.deepEqual(magicBatchRadios(session, first).seeds, [
      {
        id: "song:yt:vid1",
        title: "Midnight City",
        artists: ["M83", "Anthony Gonzalez"],
        durationMs: 244_000,
        videoId: "vid1",
      },
    ]);
  });

  test("goes on after a restart", () => {
    const { session } = startStreamedMagicQueue(streamed, { id: "s1" });
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(session))), session);
  });

  test("starts from the Library's file when the Library has the song, as its own menu would", () => {
    const track = { id: 12, title: "Midnight City", path: "/music/m83.flac" };
    assert.deepEqual(streamedSongMagicStart(track), {
      from: "library",
      seed: { kind: "track", id: "12", title: "Midnight City" },
      track,
    });
  });

  test("keeps the stream's radio seed while counting its Library file as the started song", () => {
    const { session } = startStreamedMagicQueue(streamed, {
      id: "s2",
      firstTrackId: "12",
    });
    assert.equal(session.seed.id, "yt:vid1");
    assert.equal(session.radioSeed?.videoId, "vid1");
    assert.deepEqual(session.used, ["12"]);
  });

  test("starts from the stream when the Library hasn't the song, or has it without a file", () => {
    assert.deepEqual(streamedSongMagicStart(null), { from: "stream" });
    assert.deepEqual(streamedSongMagicStart({ id: 12, title: "Midnight City", path: null }), {
      from: "stream",
    });
  });
});

describe("searchSongTap", () => {
  const file = { id: 12, title: "Midnight City", path: "/music/m83.flac" };
  const missing = { id: 13, title: "Wait", path: null };
  const stream = {
    title: "Midnight City",
    artists: ["M83"],
    album: null,
    durationMs: 244_000,
    videoId: "vid1",
    artworkUrl: null,
    explicit: false,
  };

  test("with YouTube Music on, a Library song with a file starts its own Magic Queue", () => {
    assert.deepEqual(searchSongTap({ source: "library", track: file }, { ytMusic: true }), {
      play: "magicQueue",
      from: "library",
      seed: { kind: "track", id: "12", title: "Midnight City" },
      track: file,
    });
  });

  test("with YouTube Music on, a streamed song starts its Magic Queue from the stream", () => {
    assert.deepEqual(searchSongTap({ source: "stream", song: stream }, { ytMusic: true }), {
      play: "magicQueue",
      from: "stream",
      song: stream,
    });
    assert.deepEqual(
      searchSongTap({ source: "stream", song: stream }, { ytMusic: true, found: missing }),
      { play: "magicQueue", from: "stream", song: stream },
    );
  });

  test("with YouTube Music on, a streamed song the Library has as a file starts from the file", () => {
    assert.deepEqual(
      searchSongTap({ source: "stream", song: stream }, { ytMusic: true, found: file }),
      {
        play: "magicQueue",
        from: "library",
        seed: { kind: "track", id: "12", title: "Midnight City" },
        track: file,
        song: stream,
      },
    );
  });

  test("with YouTube Music off, a song plays alone", () => {
    assert.deepEqual(searchSongTap({ source: "library", track: file }, { ytMusic: false }), {
      play: "alone",
      track: file,
    });
    assert.deepEqual(
      searchSongTap({ source: "stream", song: stream }, { ytMusic: false, found: file }),
      { play: "alone", track: file },
    );
    assert.deepEqual(searchSongTap({ source: "stream", song: stream }, { ytMusic: false }), {
      play: "nothing",
    });
  });

  test("a Library song with no file on this phone downloads, YouTube Music on or off", () => {
    for (const ytMusic of [true, false])
      assert.deepEqual(searchSongTap({ source: "library", track: missing }, { ytMusic }), {
        play: "download",
        track: missing,
      });
  });
});
