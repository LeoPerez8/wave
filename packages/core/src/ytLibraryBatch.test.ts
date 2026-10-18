import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isYtLibraryReadQueued,
  nextYtLibraryRead,
  NO_YT_LIBRARY_READS,
  planLinkImport,
  pruneYtLibraryBatch,
  queueYtLibraryReads,
  ytLibraryDownloadsQueued,
  ytLibraryDownloadsToQueue,
  ytLibraryFavorites,
  ytLibraryPauseLogLine,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  ytLibraryReadLogLine,
  ytLibraryReadView,
  readYtLibraryBatch,
  writeYtLibraryBatch,
  type YtLibraryBatch,
  type YtLibraryRead,
  type YtSong,
} from "./index.ts";

/** Three playlists Import just made, in the picker's order. */
const imported = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
  { source: "PLroad", playlistId: 41, name: "Road trip", capped: true, favorites: false },
  { source: "PLgym", playlistId: 42, name: "Gym 2", capped: true, favorites: false },
  {
    source: "RDCLAK5uy_chill",
    playlistId: 43,
    name: "Chill Hits",
    capped: true,
    favorites: false,
  },
]);

/** [playlistId]'s read in [batch], as the batch or Try Again would start it. */
const readOf = (batch: YtLibraryBatch, playlistId: number): YtLibraryRead => {
  const read = batch.reads.find((queued) => queued.playlistId === playlistId);
  assert.ok(read, `${playlistId} is in the batch`);
  return read;
};

/** [batch] once [playlistId]'s read was done. */
const readDone = (batch: YtLibraryBatch, playlistId: number): YtLibraryBatch =>
  ytLibraryReadDone(batch, readOf(batch, playlistId));

/** [batch] once [playlistId]'s read failed for a reason that doesn't pause it. */
const readFailed = (batch: YtLibraryBatch, playlistId: number): YtLibraryBatch =>
  ytLibraryReadFailed(batch, readOf(batch, playlistId), "failed").batch;

const sources = (batch: YtLibraryBatch): readonly string[] =>
  batch.reads.map((read) => read.source);

const keptAndRead = (batch: YtLibraryBatch): YtLibraryBatch => {
  const stored = writeYtLibraryBatch(batch);
  assert.ok(stored !== null, "something is kept");
  return readYtLibraryBatch(stored);
};

/** What the batch keeps of each playlist, without the token a read is told apart by. */
const kept = (batch: YtLibraryBatch) =>
  batch.reads.map(({ source, playlistId, name, capped, favorites, state }) => ({
    source,
    playlistId,
    name,
    capped,
    favorites,
    state,
  }));

describe("the batch as kept on the phone", () => {
  test("reads back as it was written: each playlist's source, Wave playlist, name and cap, waiting", () => {
    assert.deepEqual(kept(keptAndRead(imported)), [
      {
        source: "PLroad",
        playlistId: 41,
        name: "Road trip",
        capped: true,
        favorites: false,
        state: "waiting",
      },
      {
        source: "PLgym",
        playlistId: 42,
        name: "Gym 2",
        capped: true,
        favorites: false,
        state: "waiting",
      },
      {
        source: "RDCLAK5uy_chill",
        playlistId: 43,
        name: "Chill Hits",
        capped: true,
        favorites: false,
        state: "waiting",
      },
    ]);
  });

  test("Liked Songs, read whole, is kept uncapped", () => {
    const liked = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      { source: "LM", playlistId: 40, name: "Liked Songs", capped: false, favorites: false },
    ]);
    assert.deepEqual(kept(keptAndRead(liked)), [
      {
        source: "LM",
        playlistId: 40,
        name: "Liked Songs",
        capped: false,
        favorites: false,
        state: "waiting",
      },
    ]);
  });

  test("Liked Songs with Also add to Favorites on is kept starring, so a resumed read or Try Again still stars", () => {
    const liked = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      { source: "LM", playlistId: 40, name: "Liked Songs", capped: false, favorites: true },
    ]);
    const resumed = keptAndRead(liked);
    assert.equal(nextYtLibraryRead(resumed)?.favorites, true);
    assert.equal(ytLibraryReadView(keptAndRead(readFailed(resumed, 40)), 40)?.read.favorites, true);
  });

  test("a playlist kept without the Favorites choice stars nothing", () => {
    const stored = JSON.stringify({
      version: 1,
      batch: [
        { source: "LM", playlistId: 40, name: "Liked Songs", capped: false, state: "waiting" },
      ],
    });
    assert.equal(readYtLibraryBatch(stored).reads[0]?.favorites, false);
  });

  test("nothing kept, or nothing readable, is an empty batch", () => {
    for (const stored of [null, "", "not json", "[]", "{}", '{"version":1,"batch":{}}']) {
      assert.deepEqual(sources(readYtLibraryBatch(stored)), [], String(stored));
    }
  });

  test("a batch kept by a Wave that keeps it another way is an empty batch", () => {
    for (const version of [undefined, 0, 2, "1"]) {
      const stored = JSON.stringify({
        version,
        batch: [
          { source: "PLroad", playlistId: 41, name: "Road trip", capped: true, state: "waiting" },
        ],
      });
      assert.deepEqual(sources(readYtLibraryBatch(stored)), [], String(version));
    }
  });

  test("a playlist kept unreadably is left out, and the others keep their order", () => {
    const stored = JSON.stringify({
      version: 1,
      batch: [
        { source: "PLroad", playlistId: 41, name: "Road trip", capped: true, state: "waiting" },
        { source: "PLbad", playlistId: "42", name: "Bad", capped: true, state: "waiting" },
        { source: "PLodd", playlistId: 44, name: "Odd", capped: true, state: "reading" },
        null,
        { source: "PLgym", playlistId: 45, name: "Gym", capped: false, state: "failed" },
      ],
    });
    assert.deepEqual(sources(readYtLibraryBatch(stored)), ["PLroad", "PLgym"]);
  });
});

describe("resuming the batch", () => {
  test("reads the playlists in the picker's order, one at a time", () => {
    assert.equal(nextYtLibraryRead(imported)?.source, "PLroad");
    const roadRead = readDone(imported, 41);
    assert.equal(nextYtLibraryRead(roadRead)?.source, "PLgym");
    assert.equal(nextYtLibraryRead(readDone(roadRead, 42))?.source, "RDCLAK5uy_chill");
  });

  test("stopped after the first playlist was read, Wave reads the ones left in the same order", () => {
    const resumed = keptAndRead(readDone(imported, 41));
    assert.deepEqual(sources(resumed), ["PLgym", "RDCLAK5uy_chill"]);
    assert.equal(nextYtLibraryRead(resumed)?.source, "PLgym");
  });

  test("stopped partway through a read, Wave reads that playlist again first", () => {
    assert.equal(nextYtLibraryRead(keptAndRead(imported))?.source, "PLroad");
  });

  test("a later Import's playlists wait after the ones left", () => {
    const later = queueYtLibraryReads(readDone(imported, 41), [
      { source: "PLnew", playlistId: 50, name: "New", capped: true, favorites: false },
    ]);
    assert.deepEqual(sources(later), ["PLgym", "RDCLAK5uy_chill", "PLnew"]);
  });

  test("with every playlist read there is nothing left, and nothing is kept", () => {
    const done = [41, 42, 43].reduce(readDone, imported);
    assert.equal(nextYtLibraryRead(done), undefined);
    assert.equal(writeYtLibraryBatch(done), null);
  });
});

describe("a failed read", () => {
  const gymFailed = readFailed(readDone(imported, 41), 42);

  test("the rest of the batch goes on", () => {
    assert.equal(nextYtLibraryRead(gymFailed)?.source, "RDCLAK5uy_chill");
    assert.equal(nextYtLibraryRead(readDone(gymFailed, 43)), undefined);
  });

  test("its playlist's page says so, with Try Again; the others' pages say nothing", () => {
    const view = ytLibraryReadView(gymFailed, 42);
    assert.equal(view?.line, "Couldn't read it online");
    assert.deepEqual(kept({ ...gymFailed, reads: view ? [view.read] : [] }), [
      {
        source: "PLgym",
        playlistId: 42,
        name: "Gym 2",
        capped: true,
        favorites: false,
        state: "failed",
      },
    ]);
    assert.equal(ytLibraryReadView(gymFailed, 43), null, "waiting its turn");
    assert.equal(ytLibraryReadView(gymFailed, 41), null, "read");
  });

  test("is kept as failed while Wave is closed, and isn't read again on its own", () => {
    const resumed = keptAndRead(gymFailed);
    assert.equal(ytLibraryReadView(resumed, 42)?.line, "Couldn't read it online");
    assert.equal(nextYtLibraryRead(readDone(resumed, 43)), undefined);
  });

  test("once Try Again reads it, the line goes", () => {
    assert.equal(ytLibraryReadView(readDone(gymFailed, 42), 42), null);
  });

  test("the app log says which playlist wasn't read and why, and that it stays empty", () => {
    const gym = ytLibraryReadView(gymFailed, 42)?.read;
    assert.ok(gym);
    assert.equal(
      ytLibraryReadLogLine(gym, "failed"),
      `Import of "Gym 2" from YouTube Music couldn't read the playlist (failed); it stays empty, with Try Again`,
    );
  });
});

describe("a read offline, or with YT Music off", () => {
  for (const reason of ["offline", "disabled"]) {
    test(`(${reason}) pauses the batch, its playlist and the rest still waiting in order`, () => {
      const { batch, pause } = ytLibraryReadFailed(imported, readOf(imported, 41), reason);
      assert.equal(pause, true);
      assert.deepEqual(
        batch.reads.map((read) => [read.source, read.state]),
        [
          ["PLroad", "waiting"],
          ["PLgym", "waiting"],
          ["RDCLAK5uy_chill", "waiting"],
        ],
      );
      assert.equal(ytLibraryReadView(batch, 41), null, "no line: it isn't failed");
      assert.equal(nextYtLibraryRead(batch)?.source, "PLroad", "read first once it goes on");
    });

    test(`(${reason}) from Try Again leaves the line as it was`, () => {
      const gymFailed = readFailed(imported, 42);
      const gym = ytLibraryReadView(gymFailed, 42)?.read;
      assert.ok(gym);
      const { batch } = ytLibraryReadFailed(gymFailed, gym, reason);
      assert.equal(ytLibraryReadView(batch, 42)?.line, "Couldn't read it online");
    });
  }

  test("a refused read, or an answer Wave can't read, doesn't pause the batch", () => {
    for (const reason of ["failed", "HTTP 500"]) {
      assert.equal(ytLibraryReadFailed(imported, readOf(imported, 41), reason).pause, false);
    }
  });

  test("the app log says the batch waits, and why", () => {
    assert.equal(
      ytLibraryPauseLogLine(readOf(imported, 42), "offline"),
      `Import of "Gym 2" from YouTube Music waits (offline); the batch goes on when Wave starts again, comes back to the foreground or imports again`,
    );
  });
});

describe("a playlist deleted meanwhile", () => {
  test("leaves the batch, waiting or failed, and the others keep their order", () => {
    const batch = readFailed(imported, 41);
    assert.deepEqual(
      pruneYtLibraryBatch(batch, [43, 41, 7]).reads.map((read) => [read.source, read.state]),
      [
        ["PLroad", "failed"],
        ["RDCLAK5uy_chill", "waiting"],
      ],
    );
    assert.deepEqual(sources(pruneYtLibraryBatch(batch, [])), []);
  });

  test("a read that was running gives its answer to nothing", () => {
    const road = readOf(imported, 41);
    assert.equal(isYtLibraryReadQueued(imported, road), true);
    assert.equal(isYtLibraryReadQueued(pruneYtLibraryBatch(imported, [42, 43]), road), false);
  });
});

describe("a playlist refreshed while still in the batch", () => {
  test("is read once, in the new Import's order, waiting again even if its read had failed", () => {
    const gymFailed = readFailed(imported, 42);
    const refreshed = queueYtLibraryReads(gymFailed, [
      { source: "PLnew", playlistId: 50, name: "New", capped: true, favorites: false },
      { source: "PLgym", playlistId: 42, name: "Gym 2", capped: true, favorites: false },
    ]);
    assert.deepEqual(
      refreshed.reads.map((read) => [read.source, read.state]),
      [
        ["PLroad", "waiting"],
        ["RDCLAK5uy_chill", "waiting"],
        ["PLnew", "waiting"],
        ["PLgym", "waiting"],
      ],
    );
    assert.equal(ytLibraryReadView(refreshed, 42), null);
  });
});

describe("a read still running when its playlist is refreshed", () => {
  const liked = { source: "LM", playlistId: 40, name: "Liked Songs", capped: false };
  const batch = queueYtLibraryReads(NO_YT_LIBRARY_READS, [{ ...liked, favorites: false }]);
  /** Liked Songs' read, started before the refresh. */
  const running = readOf(batch, 40);
  /** Liked Songs imported again meanwhile, now with Also add to Favorites on. */
  const refreshed = queueYtLibraryReads(batch, [{ ...liked, favorites: true }]);

  test("gives its answer to nothing: the refresh's read fills the playlist", () => {
    assert.equal(isYtLibraryReadQueued(refreshed, running), false);
    assert.equal(isYtLibraryReadQueued(refreshed, readOf(refreshed, 40)), true);
  });

  test("done, leaves the refresh's read waiting, with its Favorites choice", () => {
    const next = nextYtLibraryRead(ytLibraryReadDone(refreshed, running));
    assert.equal(next?.playlistId, 40);
    assert.equal(next?.favorites, true);
  });

  test("failed, leaves the refresh's read waiting, with no line on the page", () => {
    const after = ytLibraryReadFailed(refreshed, running, "failed").batch;
    assert.equal(nextYtLibraryRead(after)?.favorites, true);
    assert.equal(ytLibraryReadView(after, 40), null);
  });

  test("Try Again's read of a failed playlist refreshed meanwhile gives its answer to nothing", () => {
    const failed = readFailed(batch, 40);
    const tryingAgain = ytLibraryReadView(failed, 40)?.read;
    assert.ok(tryingAgain);
    const again = queueYtLibraryReads(failed, [{ ...liked, favorites: true }]);
    assert.equal(isYtLibraryReadQueued(again, tryingAgain), false);
    assert.equal(nextYtLibraryRead(ytLibraryReadDone(again, tryingAgain))?.favorites, true);
  });

  test("read, then imported again: the new read is another one", () => {
    const again = queueYtLibraryReads(ytLibraryReadDone(batch, running), [
      { ...liked, favorites: false },
    ]);
    assert.equal(isYtLibraryReadQueued(again, running), false);
  });
});

const likedSong = (videoId: string, title: string, durationMs: number): YtSong => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs,
  artworkUrl: null,
  explicit: false,
});

/** Liked Songs in the batch, with Also add to Favorites [favorites]. */
const likedRead = (favorites: boolean): YtLibraryRead =>
  readOf(
    queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      { source: "LM", playlistId: 40, name: "Liked Songs", capped: false, favorites },
    ]),
    40,
  );

describe("ytLibraryFavorites", () => {
  /** The Library when the liked songs are read. */
  const library = [
    { id: 1, title: "Giorgio by Moroder", artist: "Daft Punk", durationMs: 544_000 },
    { id: 2, title: "Touch", artist: "Daft Punk", durationMs: 498_000 },
    { id: 3, title: "Contact", artist: "Daft Punk", durationMs: 381_000 },
  ];

  /** Liked Songs as read: two songs the Library has, one it hasn't, and one liked twice. */
  const plan = planLinkImport(
    {
      service: "ytMusic",
      playlist: {
        title: "Liked Music",
        artworkUrl: null,
        songs: [
          likedSong("t", "Touch", 498_000),
          likedSong("x", "Instant Crush", 337_000),
          likedSong("g", "Giorgio by Moroder", 544_000),
        ],
        repeats: [likedSong("t2", "Touch", 498_000)],
        truncated: false,
      },
    },
    library,
  );

  test("with Also add to Favorites on, stars each liked song the Library has, once", () => {
    assert.deepEqual(ytLibraryFavorites(likedRead(true), plan).star, [2, 1]);
  });

  test("each liked song the Library hasn't becomes a pending favorite, by its song and recording", () => {
    const { star, pending } = ytLibraryFavorites(likedRead(true), plan);
    assert.ok(!star.includes(3), "Contact isn't liked");
    assert.deepEqual(pending, [
      { videoId: "x", title: "Instant Crush", artists: ["Daft Punk"], durationMs: 337_000 },
    ]);
  });

  test("each pending favorite's download is asked for as a star asks, the song as YT Music found it", () => {
    assert.deepEqual(ytLibraryFavorites(likedRead(true), plan).download, [
      likedSong("x", "Instant Crush", 337_000),
    ]);
  });

  test("Import & Download asks for no star downloads: the playlist's own Download queues the songs", () => {
    const downloading = readOf(
      queueYtLibraryReads(NO_YT_LIBRARY_READS, [
        {
          source: "LM",
          playlistId: 40,
          name: "Liked Songs",
          capped: false,
          favorites: true,
          download: true,
        },
      ]),
      40,
    );
    const { pending, download } = ytLibraryFavorites(downloading, plan);
    assert.equal(pending.length, 1, "the liked song the Library hasn't is still pending");
    assert.deepEqual(download, []);
  });

  test("with it off, stars nothing and keeps nothing pending", () => {
    assert.deepEqual(ytLibraryFavorites(likedRead(false), plan), {
      star: [],
      pending: [],
      download: [],
    });
  });
});

/** Each playlist in [batch], and whether it downloads once it's read. */
const choices = (batch: YtLibraryBatch) =>
  batch.reads.map((read) => [read.playlistId, read.download]);

describe("Import & Download's choice to download", () => {
  const road = { source: "PLroad", playlistId: 41, name: "Road trip", capped: true };
  const gym = { source: "PLgym", playlistId: 42, name: "Gym 2", capped: true };
  const chill = { source: "PLchill", playlistId: 43, name: "Chill", capped: true };
  /** Two playlists Import & Download just made, and one Import made after them. */
  const downloading = queueYtLibraryReads(
    queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      { ...road, favorites: false, download: true },
      { ...gym, favorites: false, download: true },
    ]),
    [{ ...chill, favorites: false }],
  );

  test("is each playlist's own: Import's playlists download nothing", () => {
    assert.deepEqual(choices(downloading), [
      [41, true],
      [42, true],
      [43, false],
    ]);
  });

  test("survives Wave closing: the playlists read after the restart still download", () => {
    const roadRead = readDone(downloading, 41);
    const resumed = keptAndRead(ytLibraryDownloadsQueued(roadRead, readOf(roadRead, 41)));
    assert.deepEqual(choices(resumed), [
      [42, true],
      [43, false],
    ]);
    assert.equal(nextYtLibraryRead(resumed)?.download, true);
  });

  test("read and filled, a playlist keeps its choice until its downloads are queued, through Wave closing", () => {
    const roadRead = readDone(downloading, 41);
    const resumed = keptAndRead(roadRead);
    assert.deepEqual(
      ytLibraryDownloadsToQueue(resumed).map((read) => read.playlistId),
      [41],
    );
    // It isn't read again, and its page says nothing.
    assert.equal(nextYtLibraryRead(resumed)?.playlistId, 42);
    assert.equal(ytLibraryReadView(resumed, 41), null);
    const queued = ytLibraryDownloadsQueued(resumed, readOf(resumed, 41));
    assert.deepEqual(ytLibraryDownloadsToQueue(queued), []);
    assert.deepEqual(choices(queued), [
      [42, true],
      [43, false],
    ]);
  });

  test("an Import playlist, with nothing to download, leaves the batch once read", () => {
    const chillRead = readDone(downloading, 43);
    assert.deepEqual(choices(chillRead), [
      [41, true],
      [42, true],
    ]);
    assert.deepEqual(ytLibraryDownloadsToQueue(chillRead), []);
  });

  test("a playlist kept by a Wave from before Import & Download downloads nothing", () => {
    const stored = JSON.stringify({
      version: 1,
      batch: [{ ...road, favorites: false, state: "waiting" }],
    });
    assert.equal(readYtLibraryBatch(stored).reads[0]?.download, false);
  });

  test("a playlist whose read fails downloads nothing: Try Again imports it without downloading", () => {
    const gymFailed = readFailed(downloading, 42);
    assert.equal(ytLibraryReadView(gymFailed, 42)?.read.download, false);
    assert.equal(ytLibraryReadView(keptAndRead(gymFailed), 42)?.read.download, false);
    assert.equal(readOf(gymFailed, 41).download, true, "the others still download");
  });

  for (const reason of ["offline", "disabled"]) {
    test(`a batch paused (${reason}) still downloads its playlists once they're read`, () => {
      const { batch } = ytLibraryReadFailed(downloading, readOf(downloading, 41), reason);
      assert.deepEqual(choices(batch), [
        [41, true],
        [42, true],
        [43, false],
      ]);
    });
  }

  test("a playlist refreshed while still in the batch takes the new Import's choice", () => {
    const refreshed = queueYtLibraryReads(downloading, [
      { ...gym, favorites: false },
      { ...chill, favorites: false, download: true },
    ]);
    assert.deepEqual(choices(refreshed), [
      [41, true],
      [42, false],
      [43, true],
    ]);
  });
});
