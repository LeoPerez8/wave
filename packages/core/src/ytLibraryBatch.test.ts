import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  nextYtLibraryRead,
  pruneYtLibraryBatch,
  queueYtLibraryReads,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  ytLibraryReadLogLine,
  ytLibraryReadView,
  readYtLibraryBatch,
  writeYtLibraryBatch,
  type YtLibraryBatch,
} from "./index.ts";

/** Three playlists Import just made, in the picker's order. */
const imported = queueYtLibraryReads(
  [],
  [
    { source: "PLroad", playlistId: 41, name: "Road trip", capped: true },
    { source: "PLgym", playlistId: 42, name: "Gym 2", capped: true },
    { source: "RDCLAK5uy_chill", playlistId: 43, name: "Chill Hits", capped: true },
  ],
);

const keptAndRead = (batch: YtLibraryBatch): YtLibraryBatch =>
  readYtLibraryBatch(writeYtLibraryBatch(batch));

describe("the batch as kept on the phone", () => {
  test("reads back as it was written: each playlist's source, Wave playlist, name and cap, waiting", () => {
    assert.deepEqual(keptAndRead(imported), [
      { source: "PLroad", playlistId: 41, name: "Road trip", capped: true, state: "waiting" },
      { source: "PLgym", playlistId: 42, name: "Gym 2", capped: true, state: "waiting" },
      {
        source: "RDCLAK5uy_chill",
        playlistId: 43,
        name: "Chill Hits",
        capped: true,
        state: "waiting",
      },
    ]);
  });

  test("nothing kept, or nothing readable, is an empty batch", () => {
    for (const stored of [null, "", "not json", "[]", "{}", '{"version":1,"batch":{}}']) {
      assert.deepEqual(readYtLibraryBatch(stored), [], String(stored));
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
    assert.deepEqual(
      readYtLibraryBatch(stored).map((read) => read.source),
      ["PLroad", "PLgym"],
    );
  });
});

describe("resuming the batch", () => {
  test("reads the playlists in the picker's order, one at a time", () => {
    assert.equal(nextYtLibraryRead(imported)?.source, "PLroad");
    const roadRead = ytLibraryReadDone(imported, 41);
    assert.equal(nextYtLibraryRead(roadRead)?.source, "PLgym");
    assert.equal(nextYtLibraryRead(ytLibraryReadDone(roadRead, 42))?.source, "RDCLAK5uy_chill");
  });

  test("stopped after the first playlist was read, Wave reads the ones left in the same order", () => {
    const kept = keptAndRead(ytLibraryReadDone(imported, 41));
    assert.deepEqual(
      kept.map((read) => read.source),
      ["PLgym", "RDCLAK5uy_chill"],
    );
    assert.equal(nextYtLibraryRead(kept)?.source, "PLgym");
  });

  test("stopped partway through a read, Wave reads that playlist again first", () => {
    const kept = keptAndRead(imported);
    assert.equal(nextYtLibraryRead(kept)?.source, "PLroad");
  });

  test("a later Import's playlists wait after the ones left", () => {
    const later = queueYtLibraryReads(ytLibraryReadDone(imported, 41), [
      { source: "PLnew", playlistId: 50, name: "New", capped: true },
    ]);
    assert.deepEqual(
      later.map((read) => read.source),
      ["PLgym", "RDCLAK5uy_chill", "PLnew"],
    );
  });

  test("with every playlist read there is nothing left, and nothing is kept", () => {
    const done = [41, 42, 43].reduce(ytLibraryReadDone, imported);
    assert.equal(nextYtLibraryRead(done), undefined);
    assert.deepEqual(done, []);
  });
});

describe("a failed read", () => {
  const gymFailed = ytLibraryReadFailed(ytLibraryReadDone(imported, 41), 42);

  test("the rest of the batch goes on", () => {
    assert.equal(nextYtLibraryRead(gymFailed)?.source, "RDCLAK5uy_chill");
    assert.equal(nextYtLibraryRead(ytLibraryReadDone(gymFailed, 43)), undefined);
  });

  test("its playlist's page says so, with Try Again; the others' pages say nothing", () => {
    assert.deepEqual(ytLibraryReadView(gymFailed, 42), {
      line: "Couldn't read it from YouTube Music",
      read: { source: "PLgym", playlistId: 42, name: "Gym 2", capped: true, state: "failed" },
    });
    assert.equal(ytLibraryReadView(gymFailed, 43), null, "waiting its turn");
    assert.equal(ytLibraryReadView(gymFailed, 41), null, "read");
  });

  test("is kept as failed while Wave is closed, and isn't read again on its own", () => {
    const kept = keptAndRead(gymFailed);
    assert.equal(ytLibraryReadView(kept, 42)?.line, "Couldn't read it from YouTube Music");
    assert.equal(nextYtLibraryRead(ytLibraryReadDone(kept, 43)), undefined);
  });

  test("once Try Again reads it, the line goes", () => {
    assert.equal(ytLibraryReadView(ytLibraryReadDone(gymFailed, 42), 42), null);
  });

  test("the app log says which playlist wasn't read and why, and that it stays empty", () => {
    const gym = ytLibraryReadView(gymFailed, 42)?.read;
    assert.ok(gym);
    assert.equal(
      ytLibraryReadLogLine(gym, "offline"),
      `Import of "Gym 2" from YouTube Music couldn't read the playlist (offline); it stays empty, with Try Again`,
    );
  });
});

describe("a playlist deleted meanwhile", () => {
  test("leaves the batch, waiting or failed, and the others keep their order", () => {
    const batch = ytLibraryReadFailed(imported, 41);
    assert.deepEqual(
      pruneYtLibraryBatch(batch, [43, 41, 7]).map((read) => [read.source, read.state]),
      [
        ["PLroad", "failed"],
        ["RDCLAK5uy_chill", "waiting"],
      ],
    );
    assert.deepEqual(pruneYtLibraryBatch(batch, []), []);
  });
});
