import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PLAYLIST_SORTS,
  choosePlaylistSort,
  movePlaylist,
  parsePlaylistOrder,
  sortKey,
  sortPlaylists,
  storedPlaylistOrder,
} from "./index.ts";

const DAY = 86_400_000;

/** A playlist as the Library lists it: its name's sort key, and when it was made (day [day]). */
const playlist = (id: number, name: string, day = 0) => ({
  id,
  name,
  sort: sortKey(name),
  createdAt: day * DAY,
});

const names = (playlists: readonly { readonly name: string }[]): string[] =>
  playlists.map(({ name }) => name);

const NOTHING_PLAYED: ReadonlyMap<number, number> = new Map();

describe("playlist sort choice", () => {
  test("the card offers Name, Recently Added, Recently Played and Custom, in that order", () => {
    assert.deepEqual(
      PLAYLIST_SORTS.map(({ label }) => label),
      ["Name", "Recently Added", "Recently Played", "Custom"],
    );
  });

  test("a fresh install (nothing stored) sorts by name, and stores nothing until changed", () => {
    assert.deepEqual(parsePlaylistOrder(null), { sort: "name", order: [] });
    assert.equal(storedPlaylistOrder({ sort: "name", order: [] }), null);
  });

  test("every sort, with the owner's order, reads back as itself once stored", () => {
    for (const { sort } of PLAYLIST_SORTS) {
      const choice = { sort, order: [7, 3, 12] };
      assert.deepEqual(parsePlaylistOrder(storedPlaylistOrder(choice)), choice);
    }
  });

  test("junk stored reads as by name; a sort this Wave doesn't know keeps the owner's order", () => {
    assert.deepEqual(parsePlaylistOrder("not json"), { sort: "name", order: [] });
    assert.deepEqual(parsePlaylistOrder('"custom"'), { sort: "name", order: [] });
    assert.deepEqual(parsePlaylistOrder('{"sort":"shuffled","order":[2,1]}'), {
      sort: "name",
      order: [2, 1],
    });
    assert.deepEqual(parsePlaylistOrder('{"sort":"custom","order":[2,"x",1.5,null,1]}'), {
      sort: "custom",
      order: [2, 1],
    });
  });

  test("picking Custom before anything was arranged starts from the order on screen", () => {
    const chosen = choosePlaylistSort({ sort: "added", order: [] }, "custom", [4, 2, 9]);
    assert.deepEqual(chosen, { sort: "custom", order: [4, 2, 9] });
  });

  test("picking Custom again brings back the order arranged before", () => {
    const chosen = choosePlaylistSort({ sort: "name", order: [9, 4] }, "custom", [2, 4, 9]);
    assert.deepEqual(chosen, { sort: "custom", order: [9, 4] });
  });

  test("an arranged order whose playlists are all gone starts again from the screen", () => {
    const chosen = choosePlaylistSort({ sort: "name", order: [30, 31] }, "custom", [2, 4]);
    assert.deepEqual(chosen, { sort: "custom", order: [2, 4] });
  });

  test("picking another sort keeps the arranged order for later", () => {
    const chosen = choosePlaylistSort({ sort: "custom", order: [9, 4] }, "played", [9, 4]);
    assert.deepEqual(chosen, { sort: "played", order: [9, 4] });
  });
});

describe("sorting playlists", () => {
  const roadTrip = playlist(1, "Road Trip", 3);
  const theChill = playlist(2, "The Chill", 1);
  const ambient = playlist(3, "ambient", 2);

  test("by name, as the Library sorts names (case and a leading The aside)", () => {
    const sorted = sortPlaylists([roadTrip, theChill, ambient], {
      sort: "name",
      order: [],
      lastPlayed: NOTHING_PLAYED,
    });
    assert.deepEqual(names(sorted), ["ambient", "The Chill", "Road Trip"]);
  });

  test("recently added: the newest first, playlists made at once by name", () => {
    const samePlace = playlist(4, "Zydeco", 2);
    const sorted = sortPlaylists([theChill, samePlace, roadTrip, ambient], {
      sort: "added",
      order: [],
      lastPlayed: NOTHING_PLAYED,
    });
    assert.deepEqual(names(sorted), ["Road Trip", "ambient", "Zydeco", "The Chill"]);
  });

  test("recently played: the latest play first, never-played ones last by name", () => {
    const zydeco = playlist(4, "Zydeco", 5);
    const sorted = sortPlaylists([roadTrip, theChill, ambient, zydeco], {
      sort: "played",
      order: [],
      lastPlayed: new Map([
        [theChill.id, 10 * DAY],
        [roadTrip.id, 12 * DAY],
      ]),
    });
    assert.deepEqual(names(sorted), ["Road Trip", "The Chill", "ambient", "Zydeco"]);
  });

  test("recently played: two last played at the same moment go by name", () => {
    const sorted = sortPlaylists([roadTrip, theChill, ambient], {
      sort: "played",
      order: [],
      lastPlayed: new Map([
        [roadTrip.id, 4 * DAY],
        [ambient.id, 4 * DAY],
      ]),
    });
    assert.deepEqual(names(sorted), ["ambient", "Road Trip", "The Chill"]);
  });

  test("custom: the owner's order", () => {
    const sorted = sortPlaylists([roadTrip, theChill, ambient], {
      sort: "custom",
      order: [theChill.id, roadTrip.id, ambient.id],
      lastPlayed: NOTHING_PLAYED,
    });
    assert.deepEqual(names(sorted), ["The Chill", "Road Trip", "ambient"]);
  });

  test("custom: playlists made or imported since the order was arranged go on top, newest first", () => {
    const imported = playlist(4, "Imported", 9);
    const made = playlist(5, "Made", 8);
    const sorted = sortPlaylists([roadTrip, made, theChill, ambient, imported], {
      sort: "custom",
      order: [theChill.id, roadTrip.id, ambient.id],
      lastPlayed: NOTHING_PLAYED,
    });
    assert.deepEqual(names(sorted), ["Imported", "Made", "The Chill", "Road Trip", "ambient"]);
  });

  test("custom: a deleted playlist leaves the rest in order, without a gap", () => {
    const sorted = sortPlaylists([roadTrip, ambient], {
      sort: "custom",
      order: [roadTrip.id, theChill.id, ambient.id],
      lastPlayed: NOTHING_PLAYED,
    });
    assert.deepEqual(names(sorted), ["Road Trip", "ambient"]);
  });
});

describe("moving a playlist", () => {
  const a = playlist(1, "A", 1);
  const b = playlist(2, "B", 2);
  const c = playlist(3, "C", 3);
  const d = playlist(4, "D", 4);
  const all = [a, b, c, d];
  const ids = (playlists: readonly { readonly id: number }[]) => playlists.map(({ id }) => id);

  test("in Custom, a dragged playlist takes its new place and the list keeps it", () => {
    const moved = movePlaylist([b.id, d.id, a.id, c.id], 0, 2);
    assert.deepEqual(moved, { sort: "custom", order: [d.id, a.id, b.id, c.id] });
    const sorted = sortPlaylists(all, { ...moved!, lastPlayed: NOTHING_PLAYED });
    assert.deepEqual(names(sorted), ["D", "A", "B", "C"]);
  });

  test("up as well as down", () => {
    assert.deepEqual(movePlaylist([a.id, b.id, c.id, d.id], 3, 1)?.order, [a.id, d.id, b.id, c.id]);
  });

  test("under another sort, a move switches to Custom, starting from the order on screen", () => {
    const shown = sortPlaylists(all, { sort: "added", order: [a.id], lastPlayed: NOTHING_PLAYED });
    assert.deepEqual(names(shown), ["D", "C", "B", "A"]);
    const moved = movePlaylist(ids(shown), 3, 0);
    assert.deepEqual(moved, { sort: "custom", order: [a.id, d.id, c.id, b.id] });
  });

  test("a playlist new on top of a custom order keeps its place once another moves", () => {
    const e = playlist(5, "E", 5);
    const shown = sortPlaylists([...all, e], {
      sort: "custom",
      order: [c.id, b.id, a.id, d.id],
      lastPlayed: NOTHING_PLAYED,
    });
    assert.deepEqual(names(shown), ["E", "C", "B", "A", "D"]);
    const moved = movePlaylist(ids(shown), 4, 1);
    const sorted = sortPlaylists([...all, e], { ...moved!, lastPlayed: NOTHING_PLAYED });
    assert.deepEqual(names(sorted), ["E", "D", "C", "B", "A"]);
  });

  test("a move to its own place, or off either end, moves nothing", () => {
    const shown = [a.id, b.id, c.id];
    assert.equal(movePlaylist(shown, 1, 1), null);
    assert.equal(movePlaylist(shown, 0, -1), null);
    assert.equal(movePlaylist(shown, 2, 3), null);
    assert.equal(movePlaylist(shown, 5, 0), null);
  });
});
