import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseCandidates } from "./releaseLookup.ts";

test("keeps matching releases across accents and version notes, up to ten results", () => {
  assert.deepEqual(
    releaseCandidates(
      { title: "Águas de Março", artist: "Elis Regina" },
      {
        data: [
          {
            title: "Aguas de Marco (Remastered)",
            artist: { name: "Elis Regina" },
            isrc: "BRABC7400001",
            album: { id: 1 },
          },
          { title: "Other", artist: { name: "Elis Regina" }, isrc: "BRABC7400002" },
        ],
      },
    ),
    [{ isrc: "BRABC7400001", albumId: 1 }],
  );
});

import { releaseBatches, releaseBatchSplit, releaseRequestDelay } from "./releaseLookup.ts";
test("splits queries and saturated responses without dropping ISRCs", () => {
  const codes = Array.from({ length: 120 }, (_, i) => `USABC${String(i).padStart(7, "0")}`);
  const batches = releaseBatches(codes);
  assert.deepEqual(batches.flat(), codes);
  assert.ok(batches.every((b) => b.length <= 25));
  assert.deepEqual(releaseBatchSplit(codes.slice(0, 3), { count: 100, recordings: [] }), [
    [codes[0]],
    codes.slice(1, 3),
  ]);
  assert.equal(releaseRequestDelay("musicbrainz", 1000, 1500), 500);
  assert.equal(releaseRequestDelay("deezer", 1000, 1100), 250);
});

import { releaseAnswer, releaseDue } from "./releaseLookup.ts";
test("earliest first release wins; Year and album dates stay marked as fallbacks", () => {
  const response = {
    recordings: [
      { isrcs: ["GBABC9500001"], "first-release-date": "1995-10-02" },
      { isrcs: ["GBABC9500002"], "first-release-date": "1985" },
      { isrcs: ["UNRELATED"], "first-release-date": "1900" },
    ],
  };
  assert.deepEqual(
    releaseAnswer(["GBABC9500001", "GBABC9500002"], [response], 2005, "2015-01-01", 1000),
    { date: "1985", source: "first-release", retryAt: null },
  );
  assert.deepEqual(releaseAnswer([], [], 2005, "2015-01-01", 1000), {
    date: "2005",
    source: "year",
    retryAt: 2592001000,
  });
  assert.equal(releaseAnswer([], [], null, "2015-01-01", 1000).source, "album");
  assert.equal(releaseAnswer([], [], null, null, 1000, true).retryAt, 61000);
  assert.equal(releaseDue({ title: "Song", artist: "Artist" }, null, null, 0), true);
  assert.equal(releaseDue({ title: "Song", artist: "Artist" }, "1985", null, 0), false);
  const unknown = releaseAnswer([], [], null, null, 1000);
  assert.equal(releaseDue({ title: "Song", artist: "Artist" }, null, unknown, 2000), false);
  assert.equal(releaseDue({ title: "Song", artist: "Artist" }, null, unknown, 2592001000), true);
});

import { readFileSync } from "node:fs";
test("replays the forty-song live sample, including twenty Brazilian songs", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../scripts/release-lookup/sample-recorded.json", import.meta.url),
      "utf8",
    ),
  );
  let candidates = 0,
    dates = 0;
  for (const song of fixture.results) {
    const picked = releaseCandidates(song, song.response);
    assert.deepEqual(picked, song.candidates, song.title);
    const answer = releaseAnswer(
      picked.map((c) => c.isrc),
      fixture.recordings,
      null,
      null,
      0,
    );
    assert.equal(answer.date, song.answer.date, song.title);
    if (picked.length) candidates++;
    if (answer.date) dates++;
  }
  assert.equal(candidates, 36);
  assert.equal(dates, 34);
});
test("serialized retry deadlines survive a restart and answered songs remain settled", () => {
  const song = { title: "Song", artist: "Artist" };
  const unknown = JSON.parse(JSON.stringify(releaseAnswer([], [], null, null, 1000)));
  const failed = JSON.parse(JSON.stringify(releaseAnswer([], [], null, null, 1000, true)));
  assert.equal(releaseDue(song, null, failed, 60999), false);
  assert.equal(releaseDue(song, null, failed, 61000), true);
  assert.equal(releaseDue(song, null, unknown, 2592001000), true);
  assert.equal(
    releaseDue(song, null, { date: "1985", source: "first-release", retryAt: null }, 9e12),
    false,
  );
});

import { releaseTagDate } from "./releaseLookup.ts";
test("only a found first-release date goes to a file, and only to one without a date", () => {
  const found = { date: "1985-06-21", source: "first-release", retryAt: null } as const;
  assert.equal(releaseTagDate({ answer: found, held: null, hasFile: true }), "1985-06-21");
  // A YT Music entry has no file: the date stays in the index until it's downloaded.
  assert.equal(releaseTagDate({ answer: found, held: null, hasFile: false }), null);
  // An original-date tag or a typed date is never replaced.
  assert.equal(releaseTagDate({ answer: found, held: "1984", hasFile: true }), null);
  for (const source of ["year", "album", "unknown", "failed"] as const)
    assert.equal(
      releaseTagDate({ answer: { date: "2005", source, retryAt: 1 }, held: null, hasFile: true }),
      null,
      source,
    );
  assert.equal(releaseTagDate({ answer: undefined, held: null, hasFile: true }), null);
});
