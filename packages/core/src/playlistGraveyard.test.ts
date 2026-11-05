import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { graveyardRemovalsOf, graveyardRestoreIndex, graveyardSongs } from "./index.ts";

/** A playlist row in playlist order: added at 100, in the playlist unless [goneAt] says when it left. */
const row = (itemId: number, goneAt: number | null = null, addedAt = 100) => ({
  itemId,
  addedAt,
  goneAt,
});

describe("graveyardRestoreIndex", () => {
  test("puts the song back between the neighbours it had", () => {
    assert.equal(graveyardRestoreIndex([row(1), row(2, 200), row(3)], 2, 200), 1);
  });

  test("keeps the place while one old neighbour is still there", () => {
    assert.equal(graveyardRestoreIndex([row(1, 300), row(2, 200), row(3)], 2, 200), 0);
    assert.equal(graveyardRestoreIndex([row(1), row(2, 200), row(3, 300)], 2, 200), 1);
  });

  test("goes to the end once both old neighbours have left", () => {
    assert.equal(
      graveyardRestoreIndex([row(1, 300), row(2, 200), row(3, 300), row(4)], 2, 200),
      null,
    );
  });

  test("songs removed with it in one go were still its neighbours", () => {
    assert.equal(graveyardRestoreIndex([row(1, 200), row(2, 200), row(3)], 2, 200), 0);
  });

  test("a song removed before it was no longer its neighbour", () => {
    assert.equal(graveyardRestoreIndex([row(1), row(2, 150), row(3, 200), row(4)], 3, 200), 1);
  });

  test("songs added after its removal were never its neighbours", () => {
    assert.equal(
      graveyardRestoreIndex([row(1, 300), row(2, 200), row(5, null, 250), row(3, 300)], 2, 200),
      null,
    );
  });

  test("an unknown song has no place", () => {
    assert.equal(graveyardRestoreIndex([row(1)], 9, 200), null);
  });
});

const track = (id: number, title: string) => ({
  source: "library" as const,
  track: { id, title, artist: "Radiohead", durationMs: 200_000 },
});
const stream = (videoId: string, title: string) => ({
  source: "stream" as const,
  song: {
    videoId,
    title,
    artists: ["Radiohead"],
    album: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
});
const lost = (title: string) => ({
  source: "unavailable" as const,
  song: {
    title,
    artists: ["Radiohead"],
    album: null,
    durationMs: null,
    artworkUrl: null,
    reason: "notFound" as const,
  },
});
const titles = (
  items: readonly { source: string; track?: { title: string }; song?: { title: string } }[],
) => items.map((item) => `${item.source}:${item.track?.title ?? item.song?.title}`);

describe("graveyardSongs", () => {
  test("shows each removed song once, its newest removal", () => {
    const removed = [lost("Creep"), stream("v1", "Lucky"), lost("Creep")];
    assert.equal(graveyardSongs([], removed)[0], removed[0]);
    assert.deepEqual(titles(graveyardSongs([], removed)), ["unavailable:Creep", "stream:Lucky"]);
  });

  test("leaves out a song the playlist holds again", () => {
    assert.deepEqual(titles(graveyardSongs([lost("Creep")], [lost("Creep"), lost("Lucky")])), [
      "unavailable:Lucky",
    ]);
  });

  test("a YT Music song is the Library song it matches, held or removed", () => {
    assert.deepEqual(titles(graveyardSongs([track(1, "Lucky")], [stream("v1", "Lucky")])), []);
    assert.deepEqual(
      titles(graveyardSongs([], [stream("v1", "Lucky"), track(1, "Lucky"), lost("Creep")])),
      ["stream:Lucky", "unavailable:Creep"],
    );
  });
});

describe("graveyardRemovalsOf", () => {
  test("every removal of the song, as the Graveyard tells songs apart", () => {
    const removed = [stream("v1", "Lucky"), lost("Creep"), track(1, "Lucky"), lost("Lucky")];
    // The unavailable Lucky's unknown length doesn't tell it from the Library's.
    assert.deepEqual(titles(graveyardRemovalsOf(removed, removed[0]!)), [
      "stream:Lucky",
      "library:Lucky",
      "unavailable:Lucky",
    ]);
    assert.deepEqual(titles(graveyardRemovalsOf(removed, removed[1]!)), ["unavailable:Creep"]);
  });
});
