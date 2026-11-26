import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DEFAULT_DJ_SETTINGS,
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  djArtistTile,
  djGenreTile,
  genreFamily,
  magicArtistKey,
  magicStandInHeld,
  magicStandIn,
  magicStandInDue,
  reduceQueue,
  songStyle,
  startDjQueue,
  type DjAudioFeatures,
  type DjSettings,
  type DjTile,
  type MagicSession,
  type MagicSong,
  type QueueCommand,
  type QueueState,
  type TasteProfile,
  wantsMagicBatch,
} from "./index.ts";

const song = (trackId: string, artist: string): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre: null,
  style: null,
});

/** A DJ session over the selected [picked] artists, with [settings] from Adjust. */
const djSession = (settings: Partial<DjSettings> = {}, picked = ["Picked"]): MagicSession =>
  startDjQueue(
    picked.map((name) => djArtistTile(name)!),
    { id: "dj1", settings: { ...DEFAULT_DJ_SETTINGS, ...settings } },
  )!;

const run = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
  commands.reduce((current, command) => reduceQueue(current, command).state, state);

/** [session]'s queue of [trackIds], playing the last one. */
const lastPlaying = (session: MagicSession, trackIds: readonly string[]): QueueState =>
  run(EMPTY_QUEUE, {
    type: "play",
    trackIds,
    startIndex: trackIds.length - 1,
    context: { kind: MAGIC_QUEUE_CONTEXT, id: session.id },
  });

/** [session] after it queued [trackIds] (its first song and batches so far). */
const queued = (session: MagicSession, trackIds: readonly string[]): MagicSession => ({
  ...session,
  used: [...trackIds],
  batches: 1,
});

/** A graph where each artist's page lists the others as "Fans might also like". */
const graphOf = (pages: Record<string, string[]>) =>
  artistGraph({
    catalog: [],
    pages: Object.entries(pages).map(([name, similar]) => ({
      name,
      similar: similar.map((other) => ({ name: other, browseId: `UC${other}`, audience: null })),
    })),
    plays: [],
  });

/** Near is the selected artist Picked's neighbour, Far two hops out; Stranger isn't in the graph. */
const graph = graphOf({ Picked: ["Near"], Near: ["Far"] });

const ENERGETIC: DjAudioFeatures = { energy: 0.8, valence: 0.7, acousticness: 0.1, mode: 1 };
const SAD_LOUD: DjAudioFeatures = { energy: 0.8, valence: 0.2, acousticness: 0.1, mode: 0 };

describe("Library stand-in while a Magic Queue batch is late", () => {
  test("with the last song playing and no batch, plays Library songs that pass the mood", () => {
    const session = queued(djSession({ mood: ["energetic"] }), ["1", "2"]);
    const state = lastPlaying(session, ["1", "2"]);
    const library = [
      song("1", "Picked"),
      song("3", "Picked"),
      song("4", "Picked"),
      song("5", "Picked"),
    ];
    const features = new Map([
      ["1", ENERGETIC],
      ["3", SAD_LOUD],
      ["4", ENERGETIC],
      ["5", ENERGETIC],
    ]);
    const standIn = magicStandIn(session, state, library, {
      picking: true,
      moodFeatures: features,
    });
    assert.deepEqual(standIn?.trackIds, ["4", "5"]);
    // The session holds them, so neither a batch nor another stand-in plays them again.
    assert.deepEqual(standIn?.session.used, ["1", "2", "4", "5"]);
  });

  const library = [song("1", "Picked"), song("2", "Picked"), song("3", "Picked")];

  test("waits while a song after the one playing is still queued", () => {
    const session = queued(djSession(), ["1", "2"]);
    const secondToLast = run(lastPlaying(session, ["1", "2"]), { type: "previous", positionMs: 0 });
    assert.equal(secondToLast.index, 0);
    assert.equal(magicStandInDue(session, secondToLast, { picking: true }), false);
    assert.equal(magicStandIn(session, secondToLast, library, { picking: true }), null);
    assert.equal(
      magicStandInDue(session, lastPlaying(session, ["1", "2"]), { picking: true }),
      true,
    );
  });

  test("gives the first batch its pick, and stands in once that pick ends without songs", () => {
    const session = { ...djSession(), used: ["1"] };
    const state = lastPlaying(session, ["1"]);
    assert.equal(magicStandInDue(session, state, { picking: true }), false);
    assert.equal(magicStandInDue(session, state, { picking: false }), true);
    assert.deepEqual(magicStandIn(session, state, library, { picking: false })?.trackIds, [
      "2",
      "3",
    ]);
  });

  test("stands in for a later batch even while it's still being picked", () => {
    const session = queued(djSession(), ["1"]);
    assert.equal(magicStandInDue(session, lastPlaying(session, ["1"]), { picking: true }), true);
  });

  test("never stands in where the queue can't run dry or no batch may come", () => {
    const session = queued(djSession(), ["1"]);
    const state = lastPlaying(session, ["1"]);
    assert.equal(
      magicStandInDue(session, run(state, { type: "setRepeat", mode: "all" }), { picking: true }),
      false,
    );
    assert.equal(
      magicStandInDue(session, state, {
        picking: true,
        sleepTimer: { type: "endOfQueue" },
      }),
      false,
    );
    const other = run(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["1"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicStandInDue(session, other, { picking: true }), false);
  });

  test("fills with songs of unknown mood only behind the known matches, and an off one only as a last resort", () => {
    const session = queued(djSession({ mood: ["energetic"] }), ["1"]);
    const state = lastPlaying(session, ["1"]);
    const songs = [song("u1", "Picked"), song("off", "Picked"), song("m1", "Picked")];
    const features = new Map([
      ["off", SAD_LOUD],
      ["m1", ENERGETIC],
    ]);
    assert.deepEqual(
      magicStandIn(session, state, songs, { picking: true, moodFeatures: features })?.trackIds,
      ["m1", "u1"],
    );
  });

  test("with several moods, the stand-ins take turns among them, the first mood picked first", () => {
    const session = queued(djSession({ mood: ["relaxing", "energetic"] }), ["1"]);
    const state = lastPlaying(session, ["1"]);
    const CALM: DjAudioFeatures = { energy: 0.2, valence: 0.6, acousticness: 0.8, mode: 1 };
    const songs = [
      song("e1", "Picked"),
      song("e2", "Picked"),
      song("off", "Picked"),
      song("r1", "Picked"),
    ];
    const features = new Map([
      ["e1", ENERGETIC],
      ["e2", ENERGETIC],
      ["off", { ...CALM, valence: 0.1 }],
      ["r1", CALM],
    ]);
    assert.deepEqual(
      magicStandIn(session, state, songs, { picking: true, moodFeatures: features })?.trackIds,
      ["r1", "e1"],
    );
    // An unused song still comes before a replayed one, whatever its mood.
    const played = queued(session, ["1", "r1", "e1"]);
    assert.deepEqual(
      magicStandIn(played, lastPlaying(played, ["1", "r1", "e1"]), songs, {
        picking: true,
        moodFeatures: features,
      })?.trackIds,
      ["e2", "r1"],
    );
  });

  test("keeps playing songs of unknown mood when nothing in the Library is known to fit", () => {
    const session = queued(djSession({ mood: ["relaxing"] }), ["1"]);
    const state = lastPlaying(session, ["1"]);
    const songs = [song("off", "Picked"), song("u1", "Picked"), song("u2", "Picked")];
    assert.deepEqual(
      magicStandIn(session, state, songs, {
        picking: true,
        moodFeatures: new Map([["off", SAD_LOUD]]),
      })?.trackIds,
      ["u1", "u2"],
    );
  });

  test("never stands in a disliked song, nor one already queued while others are left", () => {
    const session = queued(djSession(), ["1"]);
    // "q" was added by hand (Add to Queue) and was played before the last song.
    const state = run(
      lastPlaying(session, ["1"]),
      { type: "addToQueue", trackIds: ["q"] },
      {
        type: "next",
      },
    );
    assert.equal(state.entries[state.index]?.trackId, "q");
    const songs = [
      song("q", "Picked"),
      song("bad", "Picked"),
      song("2", "Picked"),
      song("3", "Picked"),
    ];
    assert.deepEqual(
      magicStandIn(session, state, songs, { picking: true, disliked: new Set(["bad"]) })?.trackIds,
      ["2", "3"],
    );
  });

  const spread = [
    song("s1", "Stranger"),
    song("f1", "Far"),
    song("n1", "Near"),
    song("n2", "Near"),
    song("p1", "Picked"),
    song("p2", "Picked"),
  ];

  test("plays the selected artists first, then their neighbours in reach", () => {
    const low = queued(djSession({ variety: "low" }), ["1"]);
    assert.deepEqual(
      magicStandIn(low, lastPlaying(low, ["1"]), spread, { picking: true, graph })?.trackIds,
      ["p1", "p2"],
    );
    const medium = queued(djSession({ variety: "medium" }), ["1"]);
    assert.deepEqual(
      magicStandIn(medium, lastPlaying(medium, ["1"]), spread, { picking: true, graph })?.trackIds,
      ["p1", "p2"],
    );
    // Once the selection's songs are used, a neighbour in reach plays before the next hop out.
    const later = { ...medium, used: [...medium.used, "p1", "p2"] };
    assert.deepEqual(
      magicStandIn(later, lastPlaying(later, ["1"]), spread, { picking: true, graph })?.trackIds,
      ["n1", "n2"],
    );
  });

  test("fills with the nearest artists when none in reach is left, so the music doesn't stop", () => {
    const low = queued(djSession({ variety: "low" }), ["1"]);
    const songs = [song("s1", "Stranger"), song("f1", "Far"), song("n1", "Near")];
    assert.deepEqual(
      magicStandIn(low, lastPlaying(low, ["1"]), songs, { picking: true, graph })?.trackIds,
      ["n1", "f1"],
    );
  });

  test("never credits an artist twice on High while another can play", () => {
    const high = queued(djSession({ variety: "high" }), ["1"]);
    assert.deepEqual(
      magicStandIn(high, lastPlaying(high, ["1"]), spread, { picking: true, graph })?.trackIds,
      ["p1", "f1"],
    );
    const one = [song("p1", "Picked"), song("p2", "Picked")];
    assert.deepEqual(
      magicStandIn(high, lastPlaying(high, ["1"]), one, { picking: true, graph })?.trackIds,
      ["p1", "p2"],
    );
  });

  test("plays the songs the owner likes most first among those that rank alike", () => {
    const session = queued(djSession({ variety: "low" }), ["1"]);
    const taste: TasteProfile = {
      at: 0,
      songs: new Map([
        ["p2", 4],
        ["p3", -4],
      ]),
      artists: new Map(),
      genres: new Map(),
    };
    const songs = [
      song("p1", "Picked"),
      song("p3", "Picked"),
      song("p2", "Picked"),
      song("n1", "Near"),
    ];
    assert.deepEqual(
      magicStandIn(session, lastPlaying(session, ["1"]), songs, { picking: true, graph, taste })
        ?.trackIds,
      ["p2", "p1"],
    );
  });

  test("still wants the batch after its stand-ins, and stands in again once they've played", () => {
    let session = queued(djSession(), ["1"]);
    let state = lastPlaying(session, ["1"]);
    const songs = ["2", "3", "4", "5", "6"].map((id) => song(id, "Picked"));
    const played: string[] = [];
    for (let round = 0; round < 2; round++) {
      const standIn = magicStandIn(session, state, songs, { picking: true });
      assert.ok(standIn !== null);
      session = standIn.session;
      state = run(state, { type: "append", trackIds: standIn.trackIds });
      // The batch still lands after them: its ask stands, and no stand-in piles up meanwhile.
      assert.equal(wantsMagicBatch(session, state), true);
      assert.equal(magicStandInDue(session, state, { picking: true }), false);
      played.push(...standIn.trackIds);
      state = run(state, { type: "next" }, { type: "next" });
    }
    assert.deepEqual(played, ["2", "3", "4", "5"]);
  });
});

const JAZZ = genreFamily("Jazz")!.key;
const ROCK = genreFamily("Rock")!.key;

/** A song of the genre family [genre], with the style of the genre [tag] when given. */
const tagged = (
  trackId: string,
  artist: string,
  genre: string | null,
  tag?: string,
): MagicSong => ({
  ...song(trackId, artist),
  genre,
  style: tag === undefined ? null : songStyle({ genre: tag }),
});

describe("Library stand-in: the DJ selection first", () => {
  /** A DJ session from the Jazz family tile, whose artist is Miles. */
  const jazzSession = (variety: DjSettings["variety"] = "medium"): MagicSession => {
    const tile: DjTile = { ...djGenreTile("Jazz")!, artists: [{ id: 1, name: "Miles" }] };
    return queued(
      startDjQueue([tile], { id: "dj1", settings: { ...DEFAULT_DJ_SETTINGS, variety } })!,
      ["1"],
    );
  };
  /** Bandmate is a hop from Miles; Outsider isn't in the graph. */
  const jazzGraph = graphOf({ Miles: ["Bandmate"] });

  test("plays the selected family's songs before a nearer artist's songs of another genre", () => {
    const session = jazzSession();
    const songs = [
      tagged("rock1", "Bandmate", ROCK),
      tagged("rock2", "Bandmate", ROCK),
      tagged("jazz1", "Outsider", JAZZ),
      tagged("jazz2", "Outsider", JAZZ),
    ];
    assert.deepEqual(
      magicStandIn(session, lastPlaying(session, ["1"]), songs, { picking: true, graph: jazzGraph })
        ?.trackIds,
      ["jazz1", "jazz2"],
    );
  });

  test("counts a family artist's songs in only in that family or with no genre", () => {
    const session = jazzSession("low");
    const songs = [
      tagged("milesRock", "Miles", ROCK),
      tagged("milesUntagged", "Miles", null),
      tagged("milesJazz", "Miles", JAZZ),
    ];
    assert.deepEqual(
      magicStandIn(session, lastPlaying(session, ["1"]), songs, { picking: true, graph: jazzGraph })
        ?.trackIds,
      ["milesUntagged", "milesJazz"],
    );
  });

  test("plays a selected album's songs with the selected artists", () => {
    const session = queued(
      {
        ...djSession({ variety: "low" }),
        seedSongs: [{ id: "song:a1", title: "A1", artists: ["Guest"], durationMs: null, plays: 0 }],
      },
      ["1"],
    );
    const songs = [song("s1", "Stranger"), song("a1", "Guest")];
    assert.deepEqual(
      magicStandIn(session, lastPlaying(session, ["1"]), songs, { picking: true, graph })?.trackIds,
      ["a1", "s1"],
    );
  });
});

describe("Library stand-in: the music doesn't stop while the Library has songs", () => {
  const CALM: DjAudioFeatures = { energy: 0.2, valence: 0.6, acousticness: 0.8, mode: 1 };

  test("replays songs the session used that fit the mood, oldest first, before an off one", () => {
    const session = queued(djSession({ mood: ["energetic"] }), ["a", "off", "b", "c"]);
    const state = lastPlaying(session, ["b", "c"]);
    const songs = ["c", "off", "b", "a"].map((id) => song(id, "Picked"));
    const moodFeatures = new Map([
      ["a", ENERGETIC],
      ["b", ENERGETIC],
      ["c", ENERGETIC],
      ["off", CALM],
    ]);
    const standIn = magicStandIn(session, state, songs, { picking: true, moodFeatures });
    assert.deepEqual(standIn?.trackIds, ["a", "b"]);
    // Each song is held once, the replayed ones as the latest queued.
    assert.deepEqual(standIn?.session.used, ["off", "c", "a", "b"]);
  });

  test("replays the songs known to fit before the ones of unknown mood", () => {
    const session = queued(djSession({ mood: ["energetic"] }), ["u", "m", "now"]);
    const state = lastPlaying(session, ["now"]);
    const songs = ["u", "m", "now"].map((id) => song(id, "Picked"));
    const moodFeatures = new Map([
      ["m", ENERGETIC],
      ["now", ENERGETIC],
    ]);
    assert.deepEqual(
      magicStandIn(session, state, songs, { picking: true, moodFeatures })?.trackIds,
      ["m", "now"],
    );
  });

  test("plays an off-mood song as a last resort rather than stop", () => {
    // Offline, Energetic, on a Library of calm songs only.
    const session = queued(djSession({ mood: ["energetic"] }), ["1"]);
    const state = lastPlaying(session, ["1"]);
    const songs = ["1", "calm1", "calm2"].map((id) => song(id, "Picked"));
    const moodFeatures = new Map(["1", "calm1", "calm2"].map((id) => [id, CALM]));
    assert.deepEqual(
      magicStandIn(session, state, songs, { picking: true, moodFeatures })?.trackIds,
      ["calm1", "calm2"],
    );
  });

  test("stops only when the Library has no song to play", () => {
    const session = queued(djSession({ mood: ["energetic"] }), ["1"]);
    const state = lastPlaying(session, ["1"]);
    assert.equal(magicStandIn(session, state, [], { picking: true }), null);
    assert.equal(
      magicStandIn(session, state, [song("bad", "Picked")], {
        picking: true,
        disliked: new Set(["bad"]),
      }),
      null,
    );
    // The song playing is the only one left: it plays again.
    assert.deepEqual(
      magicStandIn(session, state, [song("1", "Picked")], { picking: true })?.trackIds,
      ["1"],
    );
  });

  test("keeps a small Library playing round after round", () => {
    let session = queued(djSession(), ["1"]);
    let state = lastPlaying(session, ["1"]);
    const songs = ["1", "2", "3"].map((id) => song(id, "Picked"));
    const played: string[] = [];
    for (let round = 0; round < 4; round++) {
      const standIn = magicStandIn(session, state, songs, { picking: true });
      assert.ok(standIn !== null);
      session = standIn.session;
      state = run(
        state,
        { type: "append", trackIds: standIn.trackIds },
        { type: "next" },
        { type: "next" },
      );
      played.push(...standIn.trackIds);
    }
    assert.deepEqual(played, ["2", "3", "1", "2", "3", "1", "2", "3"]);
  });
});

describe("Library stand-in: the same mood verdict as a batch", () => {
  test("a song's style rules it off when no features are cached", () => {
    const session = queued(djSession({ mood: ["relaxing"] }), ["1"]);
    const songs = [tagged("metal", "Picked", null, "Heavy Metal"), song("u1", "Picked")];
    // Heavy is off for Relaxing: the song playing replays before it.
    assert.deepEqual(
      magicStandIn(session, lastPlaying(session, ["1"]), [...songs, song("1", "Picked")], {
        picking: true,
      })?.trackIds,
      ["u1", "1"],
    );
  });
});

describe("Library stand-in songs held by the latest session", () => {
  test("holds each song once, the stand-ins as the latest queued", () => {
    const session = { ...djSession(), used: ["1", "2", "3"] };
    assert.deepEqual(magicStandInHeld(session, ["2", "4"]).used, ["1", "3", "2", "4"]);
  });
});
