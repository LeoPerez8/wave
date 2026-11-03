import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  RELEASE_BATCH_CODES,
  RELEASE_LOOKUP_VERSION,
  deezerRefused,
  lookUpReleaseDates,
  releaseAnswer,
  releaseBatchSplit,
  releaseBatches,
  releaseCandidates,
  releaseDue,
  readReleaseAnswers,
  releaseNextDue,
  releaseRequestDelay,
  releaseTagDate,
  releaseTitleDate,
  releaseTitleQuery,
  type ReleaseAnswer,
  type ReleaseLookupSong,
  type ReleaseProgress,
  type ReleaseServices,
} from "./releaseLookup.ts";

const DAY = 86_400_000;
const version = RELEASE_LOOKUP_VERSION;

/** A recorded answer from each service, 2026-11-03. */
const recorded = (service: "deezer" | "musicbrainz"): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/releaseLookup.${service}.json`, import.meta.url), "utf8"),
  );

describe("Deezer's matching recordings", () => {
  test("keep matches across accents and version notes", () => {
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

  test("ask about six ISRCs at most, each once", () => {
    // Ten matches, the second a copy of the first's recording.
    const data = Array.from({ length: 10 }, (_, index) => ({
      title: "Song",
      artist: { name: "Artist" },
      isrc: `USABC${String(index === 1 ? 0 : index).padStart(7, "0")}`,
      album: { id: index },
    }));
    const picked = releaseCandidates({ title: "Song", artist: "Artist" }, { data });
    assert.equal(picked.length, 6);
    assert.equal(new Set(picked.map((candidate) => candidate.isrc)).size, 6);
    assert.deepEqual(
      picked.map((candidate) => candidate.albumId),
      [0, 2, 3, 4, 5, 6],
    );
  });

  test("replay the forty-song live sample, including twenty Brazilian songs", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../scripts/release-lookup/sample-recorded.json", import.meta.url),
        "utf8",
      ),
    );
    let withCandidates = 0;
    let withDates = 0;
    for (const song of fixture.results) {
      const picked = releaseCandidates(song, song.response);
      const isrcs = picked.map((candidate) => candidate.isrc);
      const answer = releaseAnswer(isrcs, fixture.recordings, null, null, 0);
      // Recorded with every match: six give each song the same date.
      assert.equal(answer.date, song.answer.date, song.title);
      if (picked.length > 0) withCandidates++;
      if (answer.date !== null) withDates++;
    }
    assert.equal(withCandidates, 36);
    assert.equal(withDates, 34);
  });
});

describe("Deezer's answers", () => {
  test("an unknown album is no data, a quota or a busy service is a refusal", () => {
    // Deezer's documented error object, answered with HTTP 200.
    const error = (code: number) => ({ error: { type: "Exception", message: "", code } });
    assert.equal(deezerRefused(error(800)), false);
    assert.equal(deezerRefused(error(500)), false);
    assert.equal(deezerRefused(error(4)), true);
    assert.equal(deezerRefused(error(700)), true);
    assert.equal(deezerRefused({ data: [] }), false);
  });
});

describe("MusicBrainz queries", () => {
  test("hold each ISRC once, at most a batch's worth, and split a full page", () => {
    const codes = Array.from({ length: 120 }, (_, i) => `USABC${String(i).padStart(7, "0")}`);
    const batches = releaseBatches([...codes, codes[0]!]);
    assert.deepEqual(batches.flat(), codes);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [50, 50, 20],
    );
    assert.deepEqual(releaseBatchSplit(codes.slice(0, 3), { count: 100, recordings: [] }), [
      [codes[0]],
      codes.slice(1, 3),
    ]);
    assert.equal(releaseBatchSplit(codes.slice(0, 3), { count: 99, recordings: [] }), null);
    assert.equal(releaseBatchSplit(codes.slice(0, 1), { count: 100, recordings: [] }), null);
  });

  test("MusicBrainz waits a second between requests, Deezer 350 ms", () => {
    assert.equal(releaseRequestDelay("musicbrainz", 1000, 1500), 500);
    assert.equal(releaseRequestDelay("deezer", 1000, 1100), 250);
    assert.equal(releaseRequestDelay("deezer", 1000, 2000), 0);
  });
});

describe("MusicBrainz's recordings by title and artist", () => {
  test("search the recording and the artist as phrases", () => {
    assert.equal(
      releaseTitleQuery({ title: "Dinner & Diatribes", artist: "Hozier" }),
      'recording:"Dinner & Diatribes" AND artist:"Hozier"',
    );
    assert.equal(
      releaseTitleQuery({ title: 'Say "Hi" \\o/', artist: "AC/DC" }),
      'recording:"Say \\"Hi\\" \\\\o/" AND artist:"AC/DC"',
    );
  });

  test("find Hozier's Dinner & Diatribes, first released 2019-03-01", () => {
    // Deezer's search had only covers: no recording of Hozier's to ask MusicBrainz about.
    const hozier = { title: "Dinner & Diatribes", artist: "Hozier", durationMs: 224_146 };
    assert.deepEqual(releaseCandidates(hozier, recorded("deezer")), []);
    assert.equal(releaseTitleDate(hozier, recorded("musicbrainz")), "2019-03-01");
  });

  test("the earliest matching recording wins; one 10 s off the song's length doesn't count", () => {
    const recording = (title: string, artist: string, length: number | null, date: string) => ({
      title,
      length,
      "artist-credit": [{ name: artist, joinphrase: "" }],
      "first-release-date": date,
    });
    const response = {
      recordings: [
        recording("Song (Remastered)", "Artist", 200_000, "1999"),
        recording("Song", "Artist", 211_000, "1970"),
        recording("Song", "Artist", 189_000, "1971"),
        recording("Song", "Artist", null, "1990"),
        recording("Song", "Other", 200_000, "1960"),
        recording("Other Song", "Artist", 200_000, "1960"),
        recording("Song", "Artist", 210_000, "not a date"),
      ],
    };
    const song = { title: "Song", artist: "Artist" };
    assert.equal(releaseTitleDate({ ...song, durationMs: 200_000 }, response), "1990");
    assert.equal(releaseTitleDate({ ...song, durationMs: 210_000 }, response), "1970");
    // Without a length, every matching recording counts.
    assert.equal(releaseTitleDate(song, response), "1970");
    assert.equal(releaseTitleDate({ ...song, durationMs: 0 }, response), "1970");
    assert.equal(releaseTitleDate(song, { error: "busy" }), null);
  });

  test("a recording credited to several artists matches any of them", () => {
    const response = {
      recordings: [
        {
          title: "Song",
          "artist-credit": [
            { name: "Artist", joinphrase: " & " },
            { name: "Guest", joinphrase: "" },
          ],
          "first-release-date": "2001-02-03",
        },
      ],
    };
    assert.equal(releaseTitleDate({ title: "Song", artist: "Artist" }, response), "2001-02-03");
    assert.equal(
      releaseTitleDate({ title: "Song", artist: "Artist & Guest" }, response),
      "2001-02-03",
    );
  });
});

describe("a song's answer", () => {
  test("the earliest first release wins; Year and album dates stay marked as fallbacks", () => {
    const response = {
      recordings: [
        { isrcs: ["GBABC9500001"], "first-release-date": "1995-10-02" },
        { isrcs: ["GBABC9500002"], "first-release-date": "1985" },
        { isrcs: ["UNRELATED"], "first-release-date": "1900" },
      ],
    };
    assert.deepEqual(
      releaseAnswer(["GBABC9500001", "GBABC9500002"], [response], 2005, "2015-01-01", 1000),
      { date: "1985", source: "first-release", retryAt: null, version },
    );
    assert.deepEqual(releaseAnswer([], [], 2005, "2015-01-01", 1000), {
      date: "2005",
      source: "year",
      retryAt: 2592001000,
      version,
    });
    assert.equal(releaseAnswer([], [], null, "2015-01-01", 1000).source, "album");
    assert.equal(releaseAnswer([], [], null, null, 1000, true).retryAt, 61000);
  });

  test("a song is due without a held date and with no answer or a due retry", () => {
    const song = { title: "Song", artist: "Artist" };
    assert.equal(releaseDue(song, null, null, 0), true);
    assert.equal(releaseDue(song, "1985", null, 0), false);
    assert.equal(releaseDue({ title: " ", artist: "Artist" }, null, null, 0), false);
    const unknown = releaseAnswer([], [], null, null, 1000);
    assert.equal(releaseDue(song, null, unknown, 2000), false);
    assert.equal(releaseDue(song, null, unknown, 2592001000), true);
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

  test("a fallback or no date from an older lookup is due again once, a first release never", () => {
    const song = { title: "Song", artist: "Artist" };
    const later = 30 * DAY;
    // Answers stored before versions are the first version's.
    for (const source of ["unknown", "year", "album"] as const) {
      const date = source === "unknown" ? null : "2005";
      assert.equal(releaseDue(song, null, { date, source, retryAt: later }, 0), true, source);
      assert.equal(
        releaseDue(song, null, { date, source, retryAt: later, version: version - 1 }, 0),
        true,
        source,
      );
      assert.equal(releaseDue(song, null, { date, source, retryAt: later, version }, 0), false);
    }
    // Asked again, the new answer is this version's and waits its 30 days.
    assert.equal(releaseDue(song, null, releaseAnswer([], [], null, null, 0), 1), false);
    const found = { date: "1985", source: "first-release", retryAt: null } as const;
    assert.equal(releaseDue(song, null, found, 0), false);
    // A failed answer keeps its minute's retry.
    assert.equal(
      releaseDue(song, null, { date: null, source: "failed", retryAt: 60_000 }, 0),
      false,
    );
  });

  test("stored answers read back, and what isn't one is asked again", () => {
    const found = { date: "1985", source: "first-release", retryAt: null };
    const unknown = { date: null, source: "unknown", retryAt: 30 * DAY };
    const current = { date: "2005", source: "year", retryAt: 30 * DAY, version };
    const stored = JSON.stringify({
      found,
      unknown,
      current,
      badVersion: { date: null, source: "unknown", retryAt: 1, version: "2" },
      noSource: { date: "1985", source: "guess", retryAt: null },
      badDate: { date: "0000", source: "year", retryAt: 1 },
      badRetry: { date: null, source: "failed", retryAt: "soon" },
      notAnAnswer: 5,
    });
    assert.deepEqual(readReleaseAnswers(stored), { found, unknown, current });
    assert.deepEqual(readReleaseAnswers(null), {});
    assert.deepEqual(readReleaseAnswers("[]"), {});
  });

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
});

/** Song [n] of a playlist, with no date yet. */
const song = (n: number, extra: Partial<ReleaseLookupSong> = {}): ReleaseLookupSong => ({
  key: `song ${n}`,
  title: `Song ${n}`,
  artist: "Artist",
  year: null,
  held: null,
  answer: null,
  ...extra,
});

/** Song [n]'s [i]th ISRC. */
const isrc = (n: number, i: number) => `USABC${String(n * 10 + i).padStart(7, "0")}`;

/** Deezer's search answer for song [n]: [codes] matching recordings, on album [n]. */
const searched = (n: number, codes: number) => ({
  data: Array.from({ length: codes }, (_, i) => ({
    title: `Song ${n}`,
    artist: { name: "Artist" },
    isrc: isrc(n, i),
    album: { id: n },
  })),
});

/** MusicBrainz's answer about [codes]: each first released in [year]. */
const recordings = (codes: readonly string[], year = "1985") => [
  {
    count: codes.length,
    recordings: codes.map((code) => ({ isrcs: [code], "first-release-date": year })),
  },
];

/** A lookup run over [songs] with [services] (each request logged), and what it did. */
const run = async (
  songs: readonly ReleaseLookupSong[],
  services: Partial<ReleaseServices> = {},
  going: () => boolean = () => true,
) => {
  const log: string[] = [];
  const answers = new Map<string, ReleaseAnswer>();
  const shown: (ReleaseProgress | null)[] = [];
  const end = await lookUpReleaseDates({
    songs,
    services: {
      search: async (title, artist) => {
        log.push(`search ${title}`);
        return (services.search ?? (async (t) => searched(Number(t.split(" ")[1]), 3)))(
          title,
          artist,
        );
      },
      recordings: async (codes) => {
        log.push(`recordings ${codes.length}`);
        return (services.recordings ?? (async (c) => recordings(c)))(codes);
      },
      album: async (id) => {
        log.push(`album ${id}`);
        return (services.album ?? (async () => ({ release_date: "2005-01-01" })))(id);
      },
      titled: async (title, artist) => {
        log.push(`titled ${title}`);
        return (services.titled ?? (async () => ({ count: 0, recordings: [] })))(title, artist);
      },
    },
    now: () => 0,
    going,
    answered: async (answered, answer) => {
      answers.set(answered.key, answer);
    },
    progress: (progress) => shown.push(progress),
  });
  return { end, log, answers, shown };
};

describe("a playlist's lookup run", () => {
  test("asks MusicBrainz about whole songs, a batch's worth of ISRCs at a time", async () => {
    const songs = Array.from({ length: 30 }, (_, n) => song(n));
    const { end, log, answers } = await run(songs);
    assert.equal(end, "done");
    // Three ISRCs a song: sixteen songs fill a query, the other fourteen the next.
    assert.deepEqual(
      log.filter((line) => line.startsWith("recordings")),
      ["recordings 48", "recordings 42"],
    );
    assert.ok(48 <= RELEASE_BATCH_CODES && 48 + 3 > RELEASE_BATCH_CODES);
    assert.equal(answers.size, 30);
    assert.ok([...answers.values()].every((answer) => answer.source === "first-release"));
  });

  test("asks MusicBrainz while it goes on searching Deezer", async () => {
    const { log } = await run(Array.from({ length: 30 }, (_, n) => song(n)));
    assert.ok(log.indexOf("recordings 48") < log.indexOf("search Song 29"));
  });

  test("asks about each key once, and never about a song held or answered", async () => {
    const found: ReleaseAnswer = { date: "1990", source: "first-release", retryAt: null };
    const { log, shown } = await run([
      song(1),
      song(1, { title: "Song 1 again" }),
      song(2, { held: "1984" }),
      song(3, { answer: found }),
      song(4, { answer: { date: null, source: "unknown", retryAt: 30 * DAY, version } }),
    ]);
    assert.deepEqual(
      log.filter((line) => line.startsWith("search")),
      ["search Song 1"],
    );
    assert.deepEqual(shown[0], { done: 3, total: 4, offline: false });
    assert.equal(shown.at(-1), null);
  });

  test("an album Deezer doesn't know leaves the song for 30 days, not failed", async () => {
    const { end, answers } = await run([song(1, { year: 2005 }), song(2)], {
      recordings: async () => [{ count: 0, recordings: [] }],
      album: async () => ({ error: { type: "DataException", message: "no data", code: 800 } }),
    });
    assert.equal(end, "done");
    assert.deepEqual(answers.get("song 1"), {
      date: "2005",
      source: "year",
      retryAt: 30 * DAY,
      version,
    });
    assert.deepEqual(answers.get("song 2"), {
      date: null,
      source: "unknown",
      retryAt: 30 * DAY,
      version,
    });
  });

  test("without a first release, the earliest of the song's Deezer albums is its date", async () => {
    const { log, answers } = await run([song(1)], {
      search: async () => ({
        data: [1, 2, 3].map((i) => ({
          title: "Song 1",
          artist: { name: "Artist" },
          isrc: isrc(1, i),
          album: { id: i === 3 ? 1 : i },
        })),
      }),
      recordings: async () => [{ count: 0, recordings: [] }],
      album: async (id) => ({ release_date: id === 2 ? "1999-03-01" : "2010-05-05" }),
    });
    assert.deepEqual(
      log.filter((line) => line.startsWith("album")),
      ["album 1", "album 2"],
    );
    assert.deepEqual(answers.get("song 1"), {
      date: "1999-03-01",
      source: "album",
      retryAt: 30 * DAY,
      version,
    });
  });

  test("with no Deezer match, MusicBrainz's search by title and artist finds the date", async () => {
    const hozier = song(1, { title: "Dinner & Diatribes", artist: "Hozier", durationMs: 224_146 });
    const { end, log, answers } = await run([hozier], {
      search: async () => recorded("deezer"),
      titled: async (title, artist) =>
        title === "Dinner & Diatribes" && artist === "Hozier" ? recorded("musicbrainz") : {},
    });
    assert.equal(end, "done");
    assert.deepEqual(log, ["search Dinner & Diatribes", "titled Dinner & Diatribes"]);
    assert.deepEqual(answers.get("song 1"), {
      date: "2019-03-01",
      source: "first-release",
      retryAt: null,
      version,
    });
  });

  test("ISRCs MusicBrainz links to no date ask by title and artist before the albums", async () => {
    const titledResponse = (date: string) => ({
      recordings: [
        { title: "Song 1", "artist-credit": [{ name: "Artist" }], "first-release-date": date },
      ],
    });
    const found = await run([song(1)], {
      recordings: async () => [{ count: 0, recordings: [] }],
      titled: async () => titledResponse("1977-05-01"),
    });
    assert.deepEqual(
      found.log.filter((line) => !line.startsWith("search")),
      ["recordings 3", "titled Song 1"],
    );
    assert.equal(found.answers.get("song 1")?.date, "1977-05-01");
    assert.equal(found.answers.get("song 1")?.source, "first-release");
    // Nothing found by title either: the Year, then the albums, as before.
    const none = await run([song(1)], { recordings: async () => [{ count: 0, recordings: [] }] });
    assert.deepEqual(
      none.log.filter((line) => !line.startsWith("search")),
      ["recordings 3", "titled Song 1", "album 1"],
    );
    assert.equal(none.answers.get("song 1")?.source, "album");
    // A song with a Year needs no album.
    const year = await run([song(1, { year: 1999 })], {
      recordings: async () => [{ count: 0, recordings: [] }],
    });
    assert.ok(!year.log.some((line) => line.startsWith("album")));
    assert.equal(year.answers.get("song 1")?.source, "year");
  });

  test("a song with a first release by ISRC isn't searched by title", async () => {
    const { log } = await run([song(1)]);
    assert.ok(!log.some((line) => line.startsWith("titled")));
  });

  test("a failed search by title fails that song, keeping its fallback date", async () => {
    const { end, log, answers } = await run([song(1, { year: 1999 })], {
      recordings: async () => [{ count: 0, recordings: [] }],
      titled: async () => {
        throw new Error("Release lookup HTTP 503");
      },
    });
    assert.equal(end, "failed");
    assert.ok(!log.some((line) => line.startsWith("album")));
    assert.deepEqual(answers.get("song 1"), {
      date: "1999",
      source: "year",
      retryAt: 60_000,
      version,
    });
  });

  test("a refused search fails that song alone and stops; the songs searched are still answered", async () => {
    const { end, log, answers, shown } = await run([song(1), song(2), song(3)], {
      search: async (title) => {
        if (title === "Song 2") throw new Error("Release lookup refused");
        return searched(Number(title.split(" ")[1]), 3);
      },
    });
    assert.equal(end, "failed");
    assert.ok(!log.includes("search Song 3"));
    assert.equal(answers.get("song 1")?.source, "first-release");
    assert.deepEqual(answers.get("song 2"), {
      date: null,
      source: "failed",
      retryAt: 60_000,
      version,
    });
    assert.equal(answers.has("song 3"), false);
    assert.deepEqual(shown.at(-1), { done: 2, total: 3, offline: true });
  });

  test("a failed MusicBrainz query fails its songs, keeping a fallback date", async () => {
    const before: ReleaseAnswer = { date: "2001", source: "album", retryAt: 0 };
    const { end, answers } = await run([song(1, { answer: before }), song(2, { year: 1999 })], {
      recordings: async () => {
        throw new Error("Release lookup HTTP 503");
      },
    });
    assert.equal(end, "failed");
    assert.deepEqual(answers.get("song 1"), {
      date: "2001",
      source: "album",
      retryAt: 60_000,
      version,
    });
    assert.deepEqual(answers.get("song 2"), {
      date: "1999",
      source: "year",
      retryAt: 60_000,
      version,
    });
  });

  test("one album Deezer refuses fails that song, not the others in its query", async () => {
    const { end, answers } = await run([song(1), song(2)], {
      // Only song 2's recordings have a first release.
      recordings: async (codes) =>
        recordings(codes.filter((code) => code.startsWith("USABC000002"))),
      album: async () => {
        throw new Error("Release lookup refused");
      },
    });
    assert.equal(end, "failed");
    assert.equal(answers.get("song 1")?.source, "failed");
    assert.equal(answers.get("song 2")?.source, "first-release");
  });

  test("stopping starts nothing new and fails no song", async () => {
    let searches = 0;
    const { end, log, answers, shown } = await run(
      [song(1), song(2), song(3)],
      {
        search: async (title) => {
          searches++;
          return searched(Number(title.split(" ")[1]), 3);
        },
      },
      () => searches < 2,
    );
    assert.equal(end, "stopped");
    assert.equal(log.filter((line) => line.startsWith("search")).length, 2);
    assert.ok(!log.some((line) => line.startsWith("recordings")));
    assert.equal(answers.size, 0);
    assert.equal(shown.at(-1), null);
  });

  test("a run with nothing due makes no request and shows nothing", async () => {
    const { end, log, shown } = await run([song(1, { held: "1985" })]);
    assert.equal(end, "done");
    assert.deepEqual(log, []);
    assert.deepEqual(shown, [null]);
  });
});

describe("when a playlist's lookup is next due", () => {
  test("now for a song never asked, else the earliest retry; never for held or found songs", () => {
    const found: ReleaseAnswer = { date: "1990", source: "first-release", retryAt: null };
    const later = (retryAt: number): ReleaseAnswer => ({
      date: null,
      source: "unknown",
      retryAt,
      version,
    });
    assert.equal(releaseNextDue([song(1, { answer: found }), song(2, { held: "1985" })], 5), null);
    assert.equal(
      releaseNextDue([song(1, { answer: later(90) }), song(2, { answer: later(40) })], 5),
      40,
    );
    assert.equal(releaseNextDue([song(1, { answer: later(90) }), song(2)], 5), 5);
    assert.equal(releaseNextDue([song(1, { answer: later(2) })], 5), 5);
    assert.equal(releaseNextDue([], 5), null);
    // An older lookup's fallback is due now, once.
    const older: ReleaseAnswer = { date: "2005", source: "year", retryAt: 90 };
    assert.equal(releaseNextDue([song(1, { answer: older })], 5), 5);
    assert.equal(releaseNextDue([song(1, { answer: { ...older, version } })], 5), 90);
  });
});
