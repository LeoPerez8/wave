import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  duplicateCheckDue,
  duplicateCheckOpened,
  downloadDuplicates,
  duplicateCheckStep,
  replacementDuplicateFix,
  replacementDuplicateLines,
  replacementDuplicates,
  replacementsUnderway,
  storedDuplicateCheck,
} from "./index.ts";
import type {
  DuplicateCheck,
  DuplicateCheckEvent,
  DuplicateCheckFile,
  YtDownloadJournalJob,
} from "./index.ts";

const MP3 = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.mp3";
const M4A = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.m4a";

const file = (id: number, path: string, patch: Partial<DuplicateCheckFile> = {}) => ({
  id,
  path,
  recordingKey: "am|505",
  title: "505",
  artists: ["Arctic Monkeys"],
  durationMs: 253_000,
  favorite: false,
  plays: 0,
  playlists: [],
  ...patch,
});

/** Some history: a star, plays and an entry in playlist 10. */
const loved = { favorite: true, plays: 4, playlists: [10] };

describe("the songs an interrupted replacement left twice", () => {
  test("freeing space: the older Track went to the M4A, the MP3 left behind is the newer one", () => {
    const m4a = file(1, M4A, loved);
    const mp3 = file(2, MP3);
    assert.deepEqual(replacementDuplicates([mp3, m4a, file(3, "/Music/Other.mp3")]), [
      { old: mp3, new: m4a },
    ]);
  });

  test("best quality: the older Track went to the MP3, whichever way the switch stands now", () => {
    const mp3 = file(1, MP3);
    const m4a = file(2, M4A);
    assert.deepEqual(replacementDuplicates([m4a, mp3]), [{ old: m4a, new: mp3 }]);
  });

  test("files that merely share a name stem but are different recordings are no pair", () => {
    const other = { recordingKey: "am|505 live", title: "505 (Live)", durationMs: 290_000 };
    assert.deepEqual(replacementDuplicates([file(1, MP3), file(2, M4A, other)]), []);
  });

  test("tags keyed apart are the same recording by title, artists and length within 3 s", () => {
    const retagged = {
      recordingKey: "favourite worst nightmare|505",
      title: "505 ",
      artists: ["arctic monkeys"],
    };
    const close = file(2, M4A, { ...retagged, durationMs: 255_900 });
    assert.equal(replacementDuplicates([file(1, MP3), close]).length, 1);
    const far = file(2, M4A, { ...retagged, durationMs: 256_100 });
    assert.deepEqual(replacementDuplicates([file(1, MP3), far]), []);
    const otherArtist = file(2, M4A, { ...retagged, artists: ["The Last Shadow Puppets"] });
    assert.deepEqual(replacementDuplicates([file(1, MP3), otherArtist]), []);
  });

  test("a Library not keyed yet goes by title, artists and length", () => {
    const unkeyed = { recordingKey: null };
    assert.equal(replacementDuplicates([file(1, MP3, unkeyed), file(2, M4A, unkeyed)]).length, 1);
  });
});

describe("songs downloaded again though the Library had them", () => {
  const OWN = "/Music/Arctic Monkeys - 505.flac";
  const DOWNLOAD = "/Music/Wave/Arctic Monkeys - 505.m4a";
  const downloaded = { downloaded: true };

  test("a newer download of a song the owner's file has is paired with that file", () => {
    const own = file(1, OWN);
    const download = file(2, DOWNLOAD, { ...downloaded, ...loved });
    assert.deepEqual(downloadDuplicates([own, download]), [{ old: download, new: own }]);
  });

  test("the owner's file is kept: its Track stays and takes the download's history", () => {
    const pair = { old: file(2, DOWNLOAD, { ...downloaded, ...loved }), new: file(1, OWN) };
    const fix = replacementDuplicateFix(pair, { old: 253_000, new: 253_000 }, "download");
    assert.equal(fix.kind, "fix");
    if (fix.kind !== "fix") return;
    assert.equal(fix.keep.id, 1);
    assert.equal(fix.path, OWN);
    assert.equal(fix.deleted, DOWNLOAD);
    assert.deepEqual(fix.merge, { star: true, movePlays: true, repoint: [10], remove: [] });
  });

  test("an owner's file that isn't complete audio leaves the song on the download", () => {
    const pair = { old: file(2, DOWNLOAD, downloaded), new: file(1, OWN) };
    const fix = replacementDuplicateFix(pair, { old: 253_000, new: 90_000 }, "download");
    assert.equal(fix.kind === "fix" && fix.path, DOWNLOAD);
    assert.equal(fix.kind === "fix" && fix.deleted, OWN);
  });

  test("an owner's complete file is kept even when the download plays another length", () => {
    const pair = { old: file(2, DOWNLOAD, downloaded), new: file(1, OWN) };
    const fix = replacementDuplicateFix(pair, { old: 240_000, new: 253_000 }, "download");
    assert.equal(fix.kind === "fix" && fix.path, OWN);
  });

  test("tags keyed apart still pair by title, artists and length within 3 s", () => {
    const own = file(1, OWN, { recordingKey: "x" });
    const download = file(2, DOWNLOAD, { ...downloaded, recordingKey: "y", durationMs: 255_000 });
    assert.equal(downloadDuplicates([own, download]).length, 1);
  });

  test("two of the owner's copies, or two downloads, are left alone", () => {
    const download = file(3, DOWNLOAD, downloaded);
    assert.deepEqual(downloadDuplicates([file(1, OWN), file(2, "/Music/505.mp3"), download]), []);
    assert.deepEqual(
      downloadDuplicates([file(1, OWN), download, file(4, "/Music/Wave/505 (1).m4a", downloaded)]),
      [],
    );
  });

  test("a download older than the owner's file, or a different recording, is no pair", () => {
    assert.deepEqual(downloadDuplicates([file(2, OWN), file(1, DOWNLOAD, downloaded)]), []);
    const live = file(2, DOWNLOAD, { ...downloaded, recordingKey: "live", durationMs: 300_000 });
    assert.deepEqual(downloadDuplicates([file(1, OWN), live]), []);
  });

  test("Tracks a replacement left twice are fixed that way, not paired again", () => {
    const pair = { old: file(3, MP3), new: file(1, M4A) };
    assert.deepEqual(downloadDuplicates([file(1, M4A), file(3, MP3, downloaded)], [pair]), []);
  });

  test("a replacement pair is only ever an MP3 and an M4A", () => {
    const flac = "/Music/Arctic Monkeys/AM/Arctic Monkeys - 505.flac";
    assert.deepEqual(replacementDuplicates([file(1, flac), file(2, M4A)]), []);
  });
});

describe("putting a pair back to one song", () => {
  const full = { old: 253_100, new: 252_400 };

  test("the older Track stays on the new file when it plays the full length; the bare one goes", () => {
    const m4a = file(1, M4A, loved);
    const mp3 = file(2, MP3);
    assert.deepEqual(replacementDuplicateFix({ old: mp3, new: m4a }, full), {
      kind: "fix",
      keep: m4a,
      drop: mp3,
      path: M4A,
      deleted: MP3,
      merge: null,
    });
  });

  test("a new file that doesn't play the song's full length leaves the song on the old one", () => {
    // The same recording key, another edit: complete, but not the song's length.
    const m4a = file(1, M4A, { ...loved, durationMs: 200_000 });
    const mp3 = file(2, MP3);
    assert.deepEqual(
      replacementDuplicateFix({ old: mp3, new: m4a }, { old: 253_100, new: 200_100 }),
      { kind: "fix", keep: m4a, drop: mp3, path: MP3, deleted: M4A, merge: null },
    );
  });

  test("a new file that isn't complete audio leaves the song on the old one", () => {
    const pair = { old: file(2, MP3), new: file(1, M4A, loved) };
    const fixed = { kind: "fix", keep: pair.new, drop: pair.old, path: MP3, deleted: M4A };
    assert.deepEqual(replacementDuplicateFix(pair, { old: 253_100, new: null }), {
      ...fixed,
      merge: null,
    });
    // Its audio stops well before the length its header claims: cut short.
    assert.deepEqual(replacementDuplicateFix(pair, { old: 253_100, new: 120_000 }), {
      ...fixed,
      merge: null,
    });
  });

  test("an old file cut short goes when the new one plays the length its tags say", () => {
    const pair = { old: file(2, MP3), new: file(1, M4A, loved) };
    assert.deepEqual(replacementDuplicateFix(pair, { old: 90_000, new: 252_400 }), {
      kind: "fix",
      keep: pair.new,
      drop: pair.old,
      path: M4A,
      deleted: MP3,
      merge: null,
    });
  });

  test("neither file complete audio leaves the pair as it is: never the only copy deleted", () => {
    const pair = { old: file(2, MP3), new: file(1, M4A, loved) };
    assert.deepEqual(replacementDuplicateFix(pair, { old: null, new: 120_000 }), {
      kind: "leave",
      reason: "incomplete",
      incomplete: [MP3, M4A],
    });
  });

  test("history on both Tracks is merged: either's star, all plays, entries without doubles", () => {
    const keep = file(1, M4A, { favorite: false, plays: 2, playlists: [10, 11] });
    const drop = file(2, MP3, { favorite: true, plays: 3, playlists: [11, 12] });
    assert.deepEqual(replacementDuplicateFix({ old: drop, new: keep }, full), {
      kind: "fix",
      keep,
      drop,
      path: M4A,
      deleted: MP3,
      merge: { star: true, movePlays: true, repoint: [12], remove: [11] },
    });
  });

  test("a star the kept Track already has isn't given again; plays alone are moved", () => {
    const keep = file(1, M4A, { favorite: true });
    const drop = file(2, MP3, { favorite: true, plays: 1 });
    const fix = replacementDuplicateFix({ old: drop, new: keep }, full);
    assert.deepEqual(fix.kind === "fix" && fix.merge, {
      star: false,
      movePlays: true,
      repoint: [],
      remove: [],
    });
  });
});

describe("what the check writes to the log", () => {
  test("how many pairs it found, fixed and left, then a line per song it changed or left", () => {
    const fixed = { old: file(2, MP3), new: file(1, M4A, loved) };
    const odd = {
      old: file(4, "/Music/Gorillaz - Feel Good Inc.mp3", { title: "Feel Good Inc." }),
      new: file(3, "/Music/Gorillaz - Feel Good Inc.m4a", { title: "Feel Good Inc." }),
    };
    const both = {
      old: file(6, "/Music/a.mp3", { title: "Do I Wanna Know?", ...loved }),
      new: file(5, "/Music/a.m4a", { title: "Do I Wanna Know?", ...loved }),
    };
    const moved = {
      old: file(8, "/Music/b.mp3", { title: "R U Mine?" }),
      new: file(7, "/Music/b.m4a", { title: "R U Mine?" }),
    };
    assert.deepEqual(
      replacementDuplicateLines("update", [
        { pair: fixed, outcome: replacementDuplicateFix(fixed, { old: 253_000, new: 253_000 }) },
        { pair: odd, outcome: replacementDuplicateFix(odd, { old: null, new: null }) },
        { pair: both, outcome: replacementDuplicateFix(both, { old: 253_000, new: 253_000 }) },
        { pair: moved, outcome: { kind: "leave", reason: "changed" } },
      ]),
      [
        "Songs a replacement left twice, checked after the update: 4 pairs found, 2 fixed, 2 left alone",
        `"505" back to one song: its Track keeps its favorites, plays and playlist entries on ${M4A}; the second song went and ${MP3} was deleted`,
        `"Feel Good Inc." left twice: /Music/Gorillaz - Feel Good Inc.mp3 and /Music/Gorillaz - Feel Good Inc.m4a aren't complete audio (/Music/Gorillaz - Feel Good Inc.mp3, /Music/Gorillaz - Feel Good Inc.m4a)`,
        `"Do I Wanna Know?" back to one song: its Track keeps its favorites, plays and playlist entries on /Music/a.m4a and takes the second song's; the second song went and /Music/a.mp3 was deleted`,
        `"R U Mine?" left twice: the Library changed while it was checked (/Music/b.mp3, /Music/b.m4a)`,
      ],
    );
  });

  test("songs downloaded again get their own heading", () => {
    assert.deepEqual(replacementDuplicateLines("update", [], "download"), [
      "Songs downloaded again though the Library had them, checked after the update: 0 pairs found, 0 fixed, 0 left alone",
    ]);
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

/** Runs [events] from a launch that found [stored]: what the check asked for along the way. */
const launch = (stored: string | null, events: readonly DuplicateCheckEvent[]) => {
  let check: DuplicateCheck = duplicateCheckOpened(stored);
  let kept = stored;
  const runs: string[] = [];
  let journalReads = 0;
  for (const event of events) {
    const step = duplicateCheckStep(check, event);
    check = step.check;
    if (step.store !== null) kept = step.store;
    if (step.run !== null) runs.push(step.run);
    if (step.readJournal) journalReads++;
  }
  return { runs, kept, journalReads };
};

const scanDone = { kind: "scanDone" } as const;
const idle = { kind: "journalRead", underway: false } as const;
const busy = { kind: "journalRead", underway: true } as const;
const ran = { kind: "ran", ok: true } as const;

describe("when the check runs", () => {
  test("once after the update that brings it, then not on every launch", () => {
    const first = launch(null, [scanDone, idle, ran, idle, scanDone]);
    assert.deepEqual(first.runs, ["update"]);
    assert.deepEqual(launch(first.kept, [scanDone, idle, idle]).runs, []);
  });

  test("again after a replacement run that was interrupted, once it's through", () => {
    const done = storedDuplicateCheck(null);
    const interrupted = launch(done, [busy, scanDone, busy]);
    assert.deepEqual(interrupted.runs, []);
    assert.equal(duplicateCheckDue(interrupted.kept), "interruptedRun");
    const finished = launch(done, [busy, scanDone, busy, idle, ran]);
    assert.deepEqual(finished.runs, ["interruptedRun"]);
    assert.equal(duplicateCheckDue(finished.kept), null);
  });

  test("a run started after launch isn't an interrupted one", () => {
    const done = storedDuplicateCheck(null);
    assert.deepEqual(launch(done, [idle, scanDone, busy, idle]).runs, []);
  });

  test("it waits for the launch scan, and reads the journal when nothing read it yet", () => {
    assert.deepEqual(launch(null, [idle]).runs, []);
    const scanned = launch(null, [scanDone]);
    assert.deepEqual([scanned.runs, scanned.journalReads], [[], 1]);
  });

  test("at most once a launch; one that failed stays due for the next", () => {
    const failed = launch(null, [scanDone, idle, { kind: "ran", ok: false }, idle, scanDone]);
    assert.deepEqual(failed.runs, ["update"]);
    assert.equal(duplicateCheckDue(failed.kept), "update");
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
