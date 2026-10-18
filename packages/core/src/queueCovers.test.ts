import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  QUEUE_COVER_FLUSH_MS,
  createQueueCoverBatcher,
  playerCoverUpdates,
  withQueueCovers,
  type QueueCover,
} from "./index.ts";

type Track = {
  readonly id: string;
  readonly title: string;
  readonly artworkPath: string | null;
  readonly thumbPath: string | null;
  readonly palette?: { readonly dominant: string } | null;
};

const track = (id: string): Track => ({
  id,
  title: `Song ${id}`,
  artworkPath: `https://covers/${id}`,
  thumbPath: null,
  palette: null,
});

const cover = (id: string): QueueCover => ({
  artworkPath: `/artwork/${id}.jpg`,
  thumbPath: `/artwork/${id}.thumb.jpg`,
  palette: { dominant: "#203040" },
});

const queued = (...ids: string[]): ReadonlyMap<string, Track> =>
  new Map(ids.map((id) => [id, track(id)]));

describe("covers landing in the queue", () => {
  test("fill in the artwork, thumbnail and palette of the queued tracks they're for", () => {
    const tracks = queued("yt:a", "yt:b", "yt:c");
    const next = withQueueCovers(
      tracks,
      new Map([
        ["yt:a", cover("a")],
        ["yt:c", cover("c")],
      ]),
    );
    assert.deepEqual(next.get("yt:a"), {
      id: "yt:a",
      title: "Song yt:a",
      artworkPath: "/artwork/a.jpg",
      thumbPath: "/artwork/a.thumb.jpg",
      palette: { dominant: "#203040" },
    });
    assert.equal(next.get("yt:b"), tracks.get("yt:b"));
    assert.equal(next.get("yt:c")?.thumbPath, "/artwork/c.thumb.jpg");
    assert.deepEqual([...next.keys()], ["yt:a", "yt:b", "yt:c"]);
  });

  test("leave out tracks that left the queue meanwhile", () => {
    const next = withQueueCovers(
      queued("yt:a"),
      new Map([
        ["yt:a", cover("a")],
        ["yt:gone", cover("gone")],
      ]),
    );
    assert.deepEqual([...next.keys()], ["yt:a"]);
  });

  test("change nothing when none of their tracks is queued any more", () => {
    const tracks = queued("1", "2");
    assert.equal(withQueueCovers(tracks, new Map([["yt:gone", cover("gone")]])), tracks);
    assert.equal(withQueueCovers(tracks, new Map()), tracks);
  });
});

/** A batcher on a virtual clock, with the track that's playing set by the test. */
const setup = () => {
  let time = 0;
  let playing: string | null = null;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const batches: string[][] = [];
  const batcher = createQueueCoverBatcher({
    schedule: (ms, run) => {
      const timer = { at: time + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    playing: (trackId) => trackId === playing,
    apply: (covers) => batches.push([...covers.keys()]),
  });
  /** Moves the clock on by [ms], running the timers that fall due. */
  const advance = (ms: number): void => {
    time += ms;
    for (const timer of timers.filter((t) => !t.cancelled && t.at <= time)) {
      timer.cancelled = true;
      timer.run();
    }
  };
  return {
    batcher,
    batches,
    advance,
    play: (trackId: string) => {
      playing = trackId;
    },
    waiting: () => timers.filter((t) => !t.cancelled).length,
  };
};

describe("handing covers over to the queue", () => {
  test("covers landing close together are handed over together", () => {
    const { batcher, batches, advance } = setup();
    batcher.add("yt:a", cover("a"));
    advance(QUEUE_COVER_FLUSH_MS / 2);
    batcher.add("yt:b", cover("b"));
    batcher.add("yt:c", cover("c"));
    assert.deepEqual(batches, []);
    advance(QUEUE_COVER_FLUSH_MS / 2);
    assert.deepEqual(batches, [["yt:a", "yt:b", "yt:c"]]);
    batcher.add("yt:d", cover("d"));
    advance(QUEUE_COVER_FLUSH_MS);
    assert.deepEqual(batches, [["yt:a", "yt:b", "yt:c"], ["yt:d"]]);
  });

  test("the playing track's cover is handed over at once, with whatever waits", () => {
    const { batcher, batches, play, waiting } = setup();
    play("yt:b");
    batcher.add("yt:a", cover("a"));
    batcher.add("yt:b", cover("b"));
    assert.deepEqual(batches, [["yt:a", "yt:b"]]);
    assert.equal(waiting(), 0);
  });

  test("flushing hands over what waits straight away, and nothing when nothing does", () => {
    const { batcher, batches, waiting } = setup();
    batcher.flush();
    assert.deepEqual(batches, []);
    batcher.add("yt:a", cover("a"));
    batcher.flush();
    assert.deepEqual(batches, [["yt:a"]]);
    assert.equal(waiting(), 0);
  });

  test("a song's later cover replaces the one still waiting", () => {
    const handed: QueueCover[] = [];
    const batcher = createQueueCoverBatcher({
      schedule: () => () => {},
      playing: () => false,
      apply: (covers) => handed.push(...covers.values()),
    });
    batcher.add("yt:a", cover("a"));
    batcher.add("yt:a", cover("a2"));
    batcher.flush();
    assert.deepEqual(handed, [cover("a2")]);
  });
});

const entry = (key: string, trackId: string) => ({ key, trackId, contextIndex: null });

describe("covers reaching the player", () => {
  test("every entry of a covered song gets its cached file, in queue order", () => {
    const entries = [entry("1", "yt:a"), entry("2", "yt:b"), entry("3", "yt:a"), entry("4", "7")];
    const updates = playerCoverUpdates(
      entries,
      new Map([
        ["yt:a", cover("a")],
        ["yt:c", cover("c")],
      ]),
    );
    assert.deepEqual(updates, [
      { key: "1", artworkPath: "/artwork/a.jpg" },
      { key: "3", artworkPath: "/artwork/a.jpg" },
    ]);
  });

  test("nothing when no cover is for a queued song", () => {
    assert.deepEqual(playerCoverUpdates([entry("1", "yt:a")], new Map([["yt:b", cover("b")]])), []);
  });
});
