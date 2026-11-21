import assert from "node:assert/strict";
import { test } from "node:test";
import { onlineLyricsRows } from "./geniusLyricsSearch.ts";

const hit = (id: number, title = `Song ${id}`, artist = "Massive Attack") => ({
  id,
  title,
  artist,
  credit: artist,
  url: `https://genius.com/songs/${id}`,
  artworkUrl: null,
});
const many = Array.from({ length: 25 }, (_, index) => hit(index + 1));

test("the online lyrics section lists five hits, and Show all lists up to twenty", () => {
  const preview = onlineLyricsRows(many, [], false);
  assert.deepEqual(
    preview.rows.map((row) => row.id),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual([preview.total, preview.more], [20, true]);
  const all = onlineLyricsRows(many, [], true);
  assert.equal(all.rows.length, 20);
  assert.equal(all.rows.at(-1)?.id, 20);
  assert.equal(all.more, false);
  assert.equal(onlineLyricsRows(many.slice(0, 5), [], false).more, false);
});

test("a song a Lyrics row from the Library already shows has no online hit", () => {
  const shown = [
    { title: "Teardrop", artist: "Massive Attack", album: "Mezzanine", durationMs: 1 },
  ];
  const rows = onlineLyricsRows([hit(1, "Teardrop"), hit(2, "Angel")], shown, false);
  assert.deepEqual(
    rows.rows.map((row) => row.title),
    ["Angel"],
  );
  assert.equal(rows.total, 1);
});
