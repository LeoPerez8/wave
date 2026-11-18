import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_QUEUE,
  reduceQueue,
  ytTrackId,
  type QueueCommand,
  type QueueState,
  type YtAlbumSong,
} from "@wave/core";
import { createMagicQueue, type MagicQueueInput, type MagicQueueSong } from "./magicQueue.ts";
import type { YtRadioRead } from "./ytPages.ts";

const librarySong = (id: number, title: string): MagicQueueSong => ({
  id,
  title,
  artist: "Daft Punk",
  artistIds: [1],
  durationMs: 240_000,
  genre: "Electronic",
});

const getLucky = { ...librarySong(1, "Get Lucky"), videoId: "5NV6Rdv1a3I" };

/** A radio song of its own artist, so no artist fills a batch alone. */
const radioSong = (n: number): YtAlbumSong => ({
  videoId: `radio${String(n).padStart(6, "0")}`,
  title: `Radio Song ${n}`,
  artists: [`Radio Artist ${n}`],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

/** A radio of [size] songs a page, with more after each page. */
const radioPage = (page: number, size = 12): YtRadioRead => ({
  status: "ok",
  songs: Array.from({ length: size }, (_, n) => radioSong(page * size + n)),
  continuation: `more-${page + 1}`,
});

/** The Magic Queue over Core's queue, a Library and YT Music pages as given. */
const setup = ({
  library = [getLucky, librarySong(2, "Instant Crush")],
  songRadio = async (): Promise<YtRadioRead> => radioPage(0),
  online = true,
  continuation = (): MagicQueueInput | null => null,
}: {
  readonly library?: readonly MagicQueueSong[];
  readonly songRadio?: (videoId: string) => Promise<YtRadioRead>;
  readonly online?: boolean;
  readonly continuation?: () => MagicQueueInput | null;
} = {}) => {
  let state: QueueState = EMPTY_QUEUE;
  const asked: string[] = [];
  const world = { online, songRadio };
  const magic = createMagicQueue({
    queue: () => state,
    dispatch: async (command: QueueCommand) => {
      state = reduceQueue(state, command, () => 0).state;
    },
    library: () => ({ songs: library, artists: [{ id: 1, name: "Daft Punk" }] }),
    pages: {
      songRadio: (videoId) => {
        asked.push(`songRadio ${videoId}`);
        return world.songRadio(videoId);
      },
      radioMore: async (continuation) => {
        asked.push(`radioMore ${continuation}`);
        return radioPage(Number(continuation.slice("more-".length)));
      },
      artistRadio: async () => radioPage(50),
      findSong: async () => null,
      findArtist: async () => ({ status: "ok", browseId: null }),
    },
    ytMusic: () => true,
    online: () => world.online,
    continueQueue: () => true,
    ahead: () => null,
    continuation,
    load: () => null,
    save: () => {},
    random: () => 0,
    now: () => 1_000,
  });
  const play = async (command: QueueCommand) => {
    state = reduceQueue(state, command, () => 0).state;
    magic.queueChanged();
    await magic.settled();
  };
  /** Jumps to the queue's last song, as Next does at its end. */
  const toLast = () => play({ type: "jumpTo", key: state.entries.at(-1)!.key });
  return { magic, asked, world, play, toLast, queue: () => state };
};

test("a Magic Queue from a Library song plays it, with nine recommendations after it", async () => {
  const { magic, queue } = setup();
  await magic.start({
    seed: { kind: "track", id: "1", title: "Get Lucky" },
    songs: [getLucky],
    streamed: [],
  });
  await magic.settled();
  const state = queue();
  assert.equal(state.context?.kind, "magic");
  assert.equal(state.entries[0]?.trackId, "1");
  assert.equal(state.index, 0);
  assert.equal(state.entries.length, 1 + 9);
  assert.deepEqual(magic.view(), { title: "Get Lucky", status: "idle" });
});

test("at its last recommendation, ten more join: the queue goes past its first batch", async () => {
  const { magic, queue, toLast, asked } = setup();
  await magic.start({
    seed: { kind: "track", id: "1", title: "Get Lucky" },
    songs: [getLucky],
    streamed: [],
  });
  await magic.settled();
  await toLast();
  assert.equal(queue().entries.length, 1 + 9 + 10);
  await toLast();
  assert.equal(queue().entries.length, 1 + 9 + 10 + 10);
  // Its radio was read on past the first page.
  assert.ok(asked.includes("radioMore more-1"), asked.join(", "));
  const ids = queue().entries.map((entry) => entry.trackId);
  assert.equal(new Set(ids).size, ids.length, "no song comes twice");
});

test("offline with nothing to add, it says so; Try Again picks once back online", async () => {
  const { magic, queue, world } = setup({
    library: [getLucky],
    online: false,
    songRadio: async () => ({ status: "offline", songs: [], continuation: null }),
  });
  await magic.start({
    seed: { kind: "track", id: "1", title: "Get Lucky" },
    songs: [getLucky],
    streamed: [],
  });
  await magic.settled();
  assert.equal(queue().entries.length, 1);
  assert.equal(magic.view().status, "offline");
  world.online = true;
  world.songRadio = async () => radioPage(0);
  magic.retry();
  await magic.settled();
  assert.equal(queue().entries.length, 1 + 9);
  assert.equal(magic.view().status, "idle");
});

test("a YT Music song starts a Magic Queue of its own radio", async () => {
  const { magic, queue, asked } = setup();
  const song = radioSong(900);
  await magic.startStreamed(song);
  await magic.settled();
  assert.equal(queue().entries[0]?.trackId, ytTrackId(song.videoId));
  assert.equal(queue().entries.length, 1 + 9);
  assert.equal(asked[0], `songRadio ${song.videoId}`);
});

test("an album's queue at its last song goes on as a Magic Queue of the album", async () => {
  const album = [getLucky, librarySong(2, "Instant Crush")];
  const { queue, play, toLast } = setup({
    continuation: () => ({
      seed: { kind: "album", id: "7", title: "Random Access Memories" },
      songs: album,
      streamed: [],
    }),
  });
  await play({ type: "play", trackIds: ["1", "2"], context: { kind: "album", id: "7" } });
  assert.equal(queue().entries.length, 2);
  await toLast();
  const state = queue();
  assert.equal(state.context?.kind, "magic");
  assert.deepEqual(
    state.entries.slice(0, 2).map((entry) => entry.trackId),
    ["1", "2"],
  );
  assert.equal(state.index, 1);
  assert.equal(state.entries.length, 2 + 10);
});
