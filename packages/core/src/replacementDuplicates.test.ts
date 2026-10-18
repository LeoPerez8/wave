import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  duplicateCheckDue,
  replacementDuplicateFix,
  replacementDuplicateLines,
  replacementDuplicates,
  replacementsUnderway,
  storedDuplicateCheck,
} from "./index.ts";
import type { DuplicateCheckFile, YtDownloadJournalJob } from "./index.ts";

const MP3 = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.mp3";
const M4A = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.m4a";

const file = (id: number, path: string, patch: Partial<DuplicateCheckFile> = {}) => ({
  id,
  path,
  recordingKey: "am|505",
  title: "505",
  artists: ["Arctic Monkeys"],
  durationMs: 253_000,
  history: false,
  ...patch,
});

describe("the songs an interrupted replacement left twice", () => {
  test("an MP3 and its YouTube Music copy freeing space are a pair: old and new", () => {
    const mp3 = file(1, MP3, { history: true });
    const m4a = file(2, M4A);
    assert.deepEqual(replacementDuplicates([mp3, m4a, file(3, "/Music/Other.mp3")], "downgrade"), [
      { old: mp3, new: m4a },
    ]);
  });

  test("a best-quality MP3 replacing an M4A is a pair the other way round", () => {
    const m4a = file(1, M4A);
    const mp3 = file(2, MP3);
    assert.deepEqual(replacementDuplicates([mp3, m4a], "upgrade"), [{ old: m4a, new: mp3 }]);
  });

  test("files that merely share a name stem but are different recordings are no pair", () => {
    const other = { recordingKey: "am|505 live", title: "505 (Live)", durationMs: 290_000 };
    assert.deepEqual(replacementDuplicates([file(1, MP3), file(2, M4A, other)], "downgrade"), []);
  });

  test("tags keyed apart are the same recording by title, artists and length within 3 s", () => {
    const retagged = {
      recordingKey: "favourite worst nightmare|505",
      title: "505 ",
      artists: ["arctic monkeys"],
    };
    const close = file(2, M4A, { ...retagged, durationMs: 255_900 });
    assert.equal(replacementDuplicates([file(1, MP3), close], "downgrade").length, 1);
    const far = file(2, M4A, { ...retagged, durationMs: 256_100 });
    assert.deepEqual(replacementDuplicates([file(1, MP3), far], "downgrade"), []);
    const otherArtist = file(2, M4A, { ...retagged, artists: ["The Last Shadow Puppets"] });
    assert.deepEqual(replacementDuplicates([file(1, MP3), otherArtist], "downgrade"), []);
  });

  test("a Library not keyed yet goes by title, artists and length", () => {
    const unkeyed = { recordingKey: null };
    assert.equal(
      replacementDuplicates([file(1, MP3, unkeyed), file(2, M4A, unkeyed)], "downgrade").length,
      1,
    );
  });
});

describe("putting a pair back to one song", () => {
  const full = { old: 253_100, new: 252_400 };

  test("the Track with the history takes the finished replacement's file; the bare one goes", () => {
    const mp3 = file(1, MP3, { history: true });
    const m4a = file(2, M4A);
    assert.deepEqual(replacementDuplicateFix({ old: mp3, new: m4a }, full), {
      kind: "fix",
      keep: mp3,
      drop: m4a,
      path: M4A,
      deleted: MP3,
    });
  });

  test("a swap done before the kill: the history is already on the new file, the old file goes", () => {
    const mp3 = file(1, MP3);
    const m4a = file(2, M4A, { history: true });
    assert.deepEqual(replacementDuplicateFix({ old: mp3, new: m4a }, full), {
      kind: "fix",
      keep: m4a,
      drop: mp3,
      path: M4A,
      deleted: MP3,
    });
  });

  test("a new file that doesn't play the song's full length leaves the song on the old one", () => {
    const mp3 = file(1, MP3);
    // The same recording key, another edit: complete, but not the song's length.
    const m4a = file(2, M4A, { history: true, durationMs: 200_000 });
    assert.deepEqual(
      replacementDuplicateFix({ old: mp3, new: m4a }, { old: 253_100, new: 200_100 }),
      {
        kind: "fix",
        keep: m4a,
        drop: mp3,
        path: MP3,
        deleted: M4A,
      },
    );
  });

  test("with no history on either, the Track on the file kept stays", () => {
    const mp3 = file(1, MP3);
    const m4a = file(2, M4A);
    assert.deepEqual(replacementDuplicateFix({ old: mp3, new: m4a }, full), {
      kind: "fix",
      keep: m4a,
      drop: mp3,
      path: M4A,
      deleted: MP3,
    });
  });

  test("a file that isn't complete audio leaves the pair as it is: never the only copy deleted", () => {
    const pair = { old: file(1, MP3, { history: true }), new: file(2, M4A) };
    assert.deepEqual(replacementDuplicateFix(pair, { old: 253_100, new: null }), {
      kind: "leave",
      reason: "incomplete",
      incomplete: [M4A],
    });
    assert.deepEqual(replacementDuplicateFix(pair, { old: null, new: null }), {
      kind: "leave",
      reason: "incomplete",
      incomplete: [MP3, M4A],
    });
    // Its audio stops well before the length its header claims: cut short.
    assert.deepEqual(replacementDuplicateFix(pair, { old: 253_100, new: 120_000 }), {
      kind: "leave",
      reason: "incomplete",
      incomplete: [M4A],
    });
  });

  test("history on both Tracks is left as it is", () => {
    const pair = { old: file(1, MP3, { history: true }), new: file(2, M4A, { history: true }) };
    assert.deepEqual(replacementDuplicateFix(pair, full), { kind: "leave", reason: "bothHistory" });
  });
});

describe("what the check writes to the log", () => {
  test("how many pairs it found, fixed and left, then a line per song it changed or left", () => {
    const fixed = { old: file(1, MP3, { history: true }), new: file(2, M4A) };
    const odd = {
      old: file(3, "/Music/Gorillaz - Feel Good Inc.mp3", { title: "Feel Good Inc." }),
      new: file(4, "/Music/Gorillaz - Feel Good Inc.m4a", { title: "Feel Good Inc." }),
    };
    const both = {
      old: file(5, "/Music/a.mp3", { title: "Do I Wanna Know?", history: true }),
      new: file(6, "/Music/a.m4a", { title: "Do I Wanna Know?", history: true }),
    };
    const moved = {
      old: file(7, "/Music/b.mp3", { title: "R U Mine?" }),
      new: file(8, "/Music/b.m4a", { title: "R U Mine?" }),
    };
    assert.deepEqual(
      replacementDuplicateLines("update", [
        { pair: fixed, outcome: replacementDuplicateFix(fixed, { old: 253_000, new: 253_000 }) },
        { pair: odd, outcome: replacementDuplicateFix(odd, { old: 253_000, new: null }) },
        { pair: both, outcome: replacementDuplicateFix(both, { old: 253_000, new: 253_000 }) },
        { pair: moved, outcome: { kind: "leave", reason: "changed" } },
      ]),
      [
        "Songs a replacement left twice, checked after the update: 4 pairs found, 1 fixed, 3 left alone",
        `"505" back to one song: its Track keeps its favorites, plays and playlist entries on ${M4A}; the second song went and ${MP3} was deleted`,
        `"Feel Good Inc." left twice: /Music/Gorillaz - Feel Good Inc.m4a isn't complete audio (/Music/Gorillaz - Feel Good Inc.mp3, /Music/Gorillaz - Feel Good Inc.m4a)`,
        `"Do I Wanna Know?" left twice: both songs have favorites, plays or playlist entries (/Music/a.mp3, /Music/a.m4a)`,
        `"R U Mine?" left twice: the Library changed while it was checked (/Music/b.mp3, /Music/b.m4a)`,
      ],
    );
  });

  test("after an interrupted run, with nothing found, one line", () => {
    assert.deepEqual(replacementDuplicateLines("interruptedRun", []), [
      "Songs a replacement left twice, checked after an interrupted replacement run: 0 pairs found, 0 fixed, 0 left alone",
    ]);
  });
});

const job = (id: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id,
  song: {
    videoId: id,
    title: "505",
    artists: ["Arctic Monkeys"],
    album: null,
    durationMs: 253_000,
    artworkUrl: null,
    explicit: false,
  },
  phase: "queued",
  ...patch,
});

describe("when the check runs", () => {
  test("once after the update that brings it, then not on every launch", () => {
    assert.equal(duplicateCheckDue(null), "update");
    assert.equal(duplicateCheckDue(storedDuplicateCheck(null)), null);
  });

  test("again after a replacement run that was interrupted", () => {
    assert.equal(duplicateCheckDue(storedDuplicateCheck("interruptedRun")), "interruptedRun");
    assert.equal(duplicateCheckDue(storedDuplicateCheck(null)), null);
  });

  test("a launch finding replacements still on their way finds a run interrupted", () => {
    assert.equal(replacementsUnderway([job("downgrade:1", { phase: "transferring" })]), true);
    assert.equal(replacementsUnderway([job("upgrade:1", { phase: "queued" })]), true);
    assert.equal(
      replacementsUnderway([
        job("downgrade:1", { phase: "completed", acknowledged: true, saved: { path: M4A } }),
        job("downgrade:2", { phase: "failed", reason: "notFound" }),
        // Another download isn't a replacement.
        job("abc", { phase: "transferring" }),
      ]),
      false,
    );
  });
});
