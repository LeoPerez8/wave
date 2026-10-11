import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  checkPlaylistName,
  describePlaylistAdd,
  moveItem,
  nextPlaylistName,
  planPlaylistAdd,
  playlistMosaic,
} from "./index.ts";

describe("checkPlaylistName", () => {
  test("accepts a new name, trimmed and with runs of spaces collapsed", () => {
    assert.deepEqual(checkPlaylistName("  Road   Trip ", []), { ok: true, name: "Road Trip" });
  });

  test("a name of only spaces is empty", () => {
    assert.deepEqual(checkPlaylistName("   ", []), { ok: false, problem: "empty" });
  });

  test("a name another playlist has is taken, ignoring case, accents and spacing", () => {
    const others = ["Café del Mar", "Workout"];
    assert.deepEqual(checkPlaylistName("cafe  DEL mar", others), { ok: false, problem: "taken" });
    assert.deepEqual(checkPlaylistName("WORKOUT ", others), { ok: false, problem: "taken" });
  });

  test("a name that only shares words with another playlist is free", () => {
    assert.deepEqual(checkPlaylistName("Workout 2", ["Workout"]), { ok: true, name: "Workout 2" });
    assert.deepEqual(checkPlaylistName("The Mix", ["Mix"]), { ok: true, name: "The Mix" });
  });

  test("names are limited to 100 characters, counted after tidying", () => {
    assert.deepEqual(checkPlaylistName("a".repeat(101), []), { ok: false, problem: "tooLong" });
    assert.equal(checkPlaylistName(`  ${"a".repeat(100)}  `, []).ok, true);
  });
});

describe("nextPlaylistName", () => {
  test("the first new playlist is called New Playlist", () => {
    assert.equal(nextPlaylistName(["Workout"]), "New Playlist");
  });

  test("later ones are numbered from 2, filling the first free number", () => {
    assert.equal(nextPlaylistName(["New Playlist"]), "New Playlist 2");
    assert.equal(
      nextPlaylistName(["new playlist", "New Playlist 2", "New Playlist 4"]),
      "New Playlist 3",
    );
  });
});

describe("planPlaylistAdd", () => {
  test("appends the songs in the order they were given", () => {
    assert.deepEqual(planPlaylistAdd([1, 2], [7, 5, 6]), { add: [7, 5, 6], alreadyIn: 0 });
  });

  test("skips songs the playlist already has, and counts them", () => {
    assert.deepEqual(planPlaylistAdd([1, 2, 3], [4, 2, 5, 3]), { add: [4, 5], alreadyIn: 2 });
  });

  test("adds a song given twice once (an artist's song on two of their albums' lists)", () => {
    assert.deepEqual(planPlaylistAdd([], [4, 5, 4]), { add: [4, 5], alreadyIn: 0 });
  });
});

describe("describePlaylistAdd", () => {
  test("says how many songs went in", () => {
    assert.equal(describePlaylistAdd("Road Trip", 12, 0), "Added 12 songs to Road Trip");
    assert.equal(describePlaylistAdd("Road Trip", 1, 0), "Added 1 song to Road Trip");
  });

  test("mentions the songs that were skipped because they were already in it", () => {
    assert.equal(
      describePlaylistAdd("Road Trip", 9, 3),
      "Added 9 songs to Road Trip · 3 were already in it",
    );
    assert.equal(
      describePlaylistAdd("Road Trip", 1, 1),
      "Added 1 song to Road Trip · 1 was already in it",
    );
  });

  test("says so when nothing was added because everything was already in it", () => {
    assert.equal(describePlaylistAdd("Road Trip", 0, 1), "Already in Road Trip");
    assert.equal(describePlaylistAdd("Road Trip", 0, 4), "All 4 songs are already in Road Trip");
  });

  test("says so when there was nothing to add", () => {
    assert.equal(describePlaylistAdd("Road Trip", 0, 0), "No songs to add");
  });
});

describe("moveItem", () => {
  test("moving an item down shifts the ones it passes up", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  });

  test("moving an item up shifts the ones it passes down", () => {
    assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 1), ["a", "d", "b", "c"]);
  });

  test("a target past either end lands the item at that end", () => {
    assert.deepEqual(moveItem(["a", "b", "c"], 0, 9), ["b", "c", "a"]);
    assert.deepEqual(moveItem(["a", "b", "c"], 2, -4), ["c", "a", "b"]);
  });

  test("an item that isn't there leaves the order as it was", () => {
    assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
  });
});

describe("playlistMosaic", () => {
  test("tiles the covers of the first four albums, in playlist order", () => {
    // One cover per song, in playlist order; songs from the same album share it.
    const covers = ["kid-a", "kid-a", "blue", "ok", "kid-a", "dummy", "vespertine"];
    assert.deepEqual(playlistMosaic(covers), ["kid-a", "blue", "ok", "dummy"]);
  });

  test("with fewer than four albums, the first album's cover stands alone", () => {
    assert.deepEqual(playlistMosaic(["blue", "ok", "blue", "dummy"]), ["blue"]);
  });

  test("songs without artwork are passed over", () => {
    assert.deepEqual(playlistMosaic([null, "blue", null, "ok", "dummy", "kid-a"]), [
      "blue",
      "ok",
      "dummy",
      "kid-a",
    ]);
    assert.deepEqual(playlistMosaic([null, "blue"]), ["blue"]);
  });

  test("an empty playlist, or one with no artwork at all, has no covers", () => {
    assert.deepEqual(playlistMosaic([]), []);
    assert.deepEqual(playlistMosaic([null, null]), []);
  });
});
