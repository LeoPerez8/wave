import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { groupSongs } from "./index.ts";

const song = (id: number) => ({ id, title: `Song ${id}` });
const ids = (songs: readonly { id: number }[]) => songs.map((each) => each.id);
const idOf = (each: { id: number }) => each.id;

describe("the songs of selected groups", () => {
  test("groups come in the list's order, each keeping its own song order", () => {
    const blueTrain = [song(3), song(1), song(2)];
    const kindOfBlue = [song(10), song(11)];
    assert.deepEqual(ids(groupSongs([kindOfBlue, blueTrain], idOf)), [10, 11, 3, 1, 2]);
  });

  test("a song in several groups plays once, in the first group that has it", () => {
    // Two artists sharing a duet; a genre holding songs of both.
    const coltrane = [song(1), song(7), song(2)];
    const davis = [song(5), song(7), song(6)];
    const jazz = [song(6), song(9), song(1)];
    assert.deepEqual(ids(groupSongs([coltrane, davis, jazz], idOf)), [1, 7, 2, 5, 6, 9]);
  });

  test("a group that repeats a song on purpose keeps its repeats", () => {
    // A playlist holding a song twice plays it twice, as it does on its own screen.
    const mix = [song(6), song(9), song(6)];
    const album = [song(9), song(4)];
    assert.deepEqual(ids(groupSongs([mix, album], idOf)), [6, 9, 6, 4]);
  });

  test("no groups, or empty ones, give no songs", () => {
    assert.deepEqual(groupSongs([], idOf), []);
    assert.deepEqual(ids(groupSongs([[], [song(4)], []], idOf)), [4]);
  });
});
