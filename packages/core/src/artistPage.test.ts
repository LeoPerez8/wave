import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ARTIST_PAGE_SONGS, artistPageItems } from "./index.ts";

describe("artistPageItems", () => {
  test("each shelf is its heading then one row of all its covers, and the songs follow", () => {
    const items = artistPageItems(
      [
        { label: "Albums", covers: ["a1", "a2", "a3", "a4", "a5"] },
        { label: "Singles & EPs", covers: ["s1", "s2", "s3"] },
        { label: "Appears on", covers: ["x1"] },
      ],
      ["t1", "t2"],
    );
    assert.deepEqual(items, [
      { type: "section", label: "Albums" },
      { type: "shelf", label: "Albums", covers: ["a1", "a2", "a3", "a4", "a5"] },
      { type: "section", label: "Singles & EPs" },
      { type: "shelf", label: "Singles & EPs", covers: ["s1", "s2", "s3"] },
      { type: "section", label: "Appears on" },
      { type: "shelf", label: "Appears on", covers: ["x1"] },
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
      { type: "song", song: "t2", index: 1 },
    ]);
  });

  test("the songs' heading reads as given: Popular when they're in YouTube Music's order", () => {
    const items = artistPageItems([], ["t1"], "Popular");
    assert.deepEqual(items, [
      { type: "section", label: "Popular" },
      { type: "song", song: "t1", index: 0 },
    ]);
  });

  test("a shelf with nothing in it is left out, heading and all", () => {
    const items = artistPageItems(
      [
        { label: "Albums", covers: [] },
        { label: "Singles & EPs", covers: ["s1"] },
        { label: "Appears on", covers: [] },
      ],
      ["t1"],
    );
    assert.deepEqual(items, [
      { type: "section", label: "Singles & EPs" },
      { type: "shelf", label: "Singles & EPs", covers: ["s1"] },
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
    ]);
  });

  test("with no songs there's no Songs heading", () => {
    assert.deepEqual(artistPageItems([{ label: "Albums", covers: ["a1"] }], []), [
      { type: "section", label: "Albums" },
      { type: "shelf", label: "Albums", covers: ["a1"] },
    ]);
  });

  test("while Find in artist narrows the songs, the shelves and the heading step aside", () => {
    const items = artistPageItems(
      [{ label: "Albums", covers: ["a1"] }],
      ["t1", "t2", "t3"],
      "Songs",
      [0, 2],
    );
    // Each song found keeps its place among the page's songs, so a tap plays the page from it.
    assert.deepEqual(items, [
      { type: "song", song: "t1", index: 0 },
      { type: "song", song: "t3", index: 2 },
    ]);
  });

  test("a query that finds nothing leaves the list empty", () => {
    assert.deepEqual(
      artistPageItems([{ label: "Albums", covers: ["a1"] }], ["t1"], "Songs", []),
      [],
    );
  });

  test("with nothing typed the whole page shows", () => {
    assert.deepEqual(artistPageItems([], ["t1"], "Songs", null), [
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
    ]);
  });

  test("Fans might also like is its heading then one row of artists, after the songs", () => {
    const items = artistPageItems([{ label: "Albums", covers: ["a1"] }], ["t1"], "Songs", null, {
      similar: { label: "Fans might also like", artists: ["Justice", "Air"] },
    });
    assert.deepEqual(items, [
      { type: "section", label: "Albums" },
      { type: "shelf", label: "Albums", covers: ["a1"] },
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
      { type: "section", label: "Fans might also like" },
      { type: "similar", label: "Fans might also like", artists: ["Justice", "Air"] },
    ]);
  });

  test("a page with no similar artists has no Fans might also like", () => {
    assert.deepEqual(
      artistPageItems([], ["t1"], "Songs", null, {
        similar: { label: "Fans might also like", artists: [] },
      }),
      [
        { type: "section", label: "Songs" },
        { type: "song", song: "t1", index: 0 },
      ],
    );
  });

  test("Fans might also like steps aside while Find in artist narrows the songs", () => {
    assert.deepEqual(
      artistPageItems([], ["t1", "t2"], "Songs", [1], {
        similar: { label: "Fans might also like", artists: ["Justice"] },
      }),
      [{ type: "song", song: "t2", index: 1 }],
    );
  });

  test("a page with no songs still shows Fans might also like", () => {
    assert.deepEqual(
      artistPageItems([], [], "Songs", null, {
        similar: { label: "Fans might also like", artists: ["Justice"] },
      }),
      [
        { type: "section", label: "Fans might also like" },
        { type: "similar", label: "Fans might also like", artists: ["Justice"] },
      ],
    );
  });

  test("About follows the artist's parts and steps aside while Find narrows songs", () => {
    const about = { description: "A biography", subscribers: "7.19M", views: null };
    assert.deepEqual(artistPageItems([], ["t1"], "Songs", null, { about }), [
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
      { type: "about", about },
    ]);
    assert.deepEqual(artistPageItems([], ["t1"], "Songs", [0], { about }), [
      { type: "song", song: "t1", index: 0 },
    ]);
  });

  describe("the songs cut at the first few", () => {
    const songs = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];

    test("an artist page shows five songs", () => {
      assert.equal(ARTIST_PAGE_SONGS, 5);
    });

    test("past the cut, See More follows the songs shown and counts them all", () => {
      const items = artistPageItems([], songs, "Popular", null, {}, 5);
      assert.deepEqual(items, [
        { type: "section", label: "Popular" },
        { type: "song", song: "t1", index: 0 },
        { type: "song", song: "t2", index: 1 },
        { type: "song", song: "t3", index: 2 },
        { type: "song", song: "t4", index: 3 },
        { type: "song", song: "t5", index: 4 },
        { type: "more", total: 7 },
      ]);
    });

    test("at the cut or under it there's no See More", () => {
      const five = songs.slice(0, 5);
      assert.deepEqual(
        artistPageItems([], five, "Songs", null, {}, 5).map((item) => item.type),
        ["section", "song", "song", "song", "song", "song"],
      );
    });

    test("Fans might also like and About follow See More", () => {
      const about = { description: "A biography", subscribers: null, views: null };
      const items = artistPageItems(
        [],
        songs,
        "Songs",
        null,
        { similar: { label: "Fans might also like", artists: ["Air"] }, about },
        5,
      );
      assert.deepEqual(items.slice(-4), [
        { type: "more", total: 7 },
        { type: "section", label: "Fans might also like" },
        { type: "similar", label: "Fans might also like", artists: ["Air"] },
        { type: "about", about },
      ]);
    });

    test("while Find in artist narrows the songs, every song found shows, past the cut too", () => {
      assert.deepEqual(artistPageItems([], songs, "Songs", [1, 5, 6], {}, 5), [
        { type: "song", song: "t2", index: 1 },
        { type: "song", song: "t6", index: 5 },
        { type: "song", song: "t7", index: 6 },
      ]);
    });

    test("with no cut given, every song shows", () => {
      assert.equal(artistPageItems([], songs).filter((item) => item.type === "song").length, 7);
    });
  });
});
