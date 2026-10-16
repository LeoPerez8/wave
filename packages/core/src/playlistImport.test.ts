import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SPOTIFY_SEARCHES_AT_ONCE,
  importAdded,
  importAdditions,
  importSearchAnswered,
  importTurn,
  nextImportStep,
  planLinkImport,
  playlistImportProgress,
  playlistImportView,
  queuePlaylistImport,
  readPlaylistImports,
  retryPlaylistImport,
  startPlaylistImport,
  updatePlaylistImport,
  withoutPlaylistImport,
  writePlaylistImports,
  readSpotifySearchPacing,
  writeSpotifySearchPacing,
  type PlaylistImport,
  type SpotifySearchPacing,
  type SpotifySong,
  type YtSong,
} from "./index.ts";

const yt = (videoId: string, title: string, fields: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});

const spotify = (title: string, fields: Partial<SpotifySong> = {}): SpotifySong => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  ...fields,
});

const library = [
  { id: 1, title: "Giorgio by Moroder", artist: "Daft Punk", durationMs: 544_000 },
  { id: 2, title: "Touch", artist: "Daft Punk", durationMs: 498_000 },
];

const ytPlaylist = (songs: readonly YtSong[], title = "Late Night") => ({
  service: "ytMusic" as const,
  playlist: { title, artworkUrl: null, songs, truncated: false },
});

const spotifyPlaylist = (songs: readonly SpotifySong[], title = "Late Night") => ({
  service: "spotify" as const,
  playlist: { title, artworkUrl: null, songs, truncated: false },
});

/** Hands over everything settled, as the app does, and gives back what was added. */
const handOver = <S extends YtSong>(job: PlaylistImport<S>) => {
  const { songs, through } = importAdditions(job);
  return { job: importAdded(job, through), songs };
};

describe("a YouTube Music playlist import", () => {
  test("the playlist gets every song at once, in the source's order, the Library's as its tracks", () => {
    const plan = planLinkImport(
      ytPlaylist([
        yt("a", "Giorgio by Moroder", { durationMs: 544_000 }),
        yt("b", "Within", { durationMs: 228_000 }),
        yt("c", "Touch", { durationMs: 498_000 }),
      ]),
      library,
    );
    const job = startPlaylistImport(plan, { playlistId: 7, name: "Late Night" });
    const { songs, job: after } = handOver(job);
    assert.deepEqual(songs, [
      { source: "library", trackId: 1 },
      { source: "stream", song: yt("b", "Within", { durationMs: 228_000 }) },
      { source: "library", trackId: 2 },
    ]);
    assert.equal(after.state.kind, "done");
    assert.deepEqual(importAdditions(after).songs, []);
  });

  test("a song that comes twice, or two that are one Library song, goes in once", () => {
    const plan = planLinkImport(
      ytPlaylist([
        yt("a", "Touch", { durationMs: 498_000 }),
        yt("b", "Within"),
        yt("c", "Touch (feat. Paul Williams)", { durationMs: 498_000 }),
        yt("b", "Within"),
      ]),
      library,
    );
    const { songs } = handOver(startPlaylistImport(plan, { playlistId: 7, name: "Late Night" }));
    assert.deepEqual(songs, [
      { source: "library", trackId: 2 },
      { source: "stream", song: yt("b", "Within") },
    ]);
    assert.equal(plan.songs.length, 2, "the card counts each song once");
    assert.equal(plan.inLibrary, 1);
  });
});

describe("a Spotify playlist listing a song more than once", () => {
  test("counts it once, and imports it once", () => {
    const plan = planLinkImport(
      spotifyPlaylist([
        spotify("Touch", { durationMs: 498_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Touch", { durationMs: 498_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Within", { durationMs: 228_000 }),
        spotify("Untitled", { artists: [] }),
        spotify("Untitled", { artists: [] }),
        spotify("Within (Live)", { durationMs: 228_000 }),
      ]),
      library,
    );
    assert.deepEqual(
      plan.songs.map((song) => song.title),
      ["Touch", "Within", "Untitled", "Within (Live)"],
    );
    assert.equal(plan.inLibrary, 1);
    assert.deepEqual(plan.finds, [
      { kind: "library", trackId: 2 },
      null,
      { kind: "notFound" },
      null,
    ]);
  });
});

/** Takes every search the import asks now, until it waits for answers. */
const askAll = <S extends YtSong>(
  job: PlaylistImport<S>,
  now = 0,
  searches: SpotifySearchPacing = readSpotifySearchPacing(null),
) => {
  const asked: string[] = [];
  let current = job;
  let pacing = searches;
  for (;;) {
    const next = nextImportStep(current, now, pacing);
    current = next.job;
    pacing = next.searches;
    if (next.step.kind !== "search")
      return { job: current, asked, step: next.step, searches: pacing };
    asked.push(next.step.query);
  }
};

const QUERIES = [
  "Within Daft Punk",
  "Instant Crush Daft Punk Julian Casablancas",
  "Lose Yourself to Dance Daft Punk",
  "Doin' it Right Daft Punk",
];

describe("a Spotify playlist import", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Instant Crush", { artists: ["Daft Punk", "Julian Casablancas"], durationMs: 337_000 }),
    spotify("Untitled", { artists: [] }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Lose Yourself to Dance", { durationMs: 353_000 }),
    spotify("Doin' it Right", { durationMs: 251_000 }),
    spotify("Fragments of Time", { durationMs: 279_000 }),
  ];
  const start = () =>
    startPlaylistImport(planLinkImport(spotifyPlaylist(songs), library), {
      playlistId: 7,
      name: "Late Night",
    });

  test(`searches the songs the Library hasn't, in the playlist's order, at most ${SPOTIFY_SEARCHES_AT_ONCE} at once`, () => {
    const { asked, step } = askAll(start());
    assert.deepEqual(asked, QUERIES);
    assert.equal(step.kind, "answers");
  });

  test("the Library's songs go in at once; each song found goes in once those before it are settled", () => {
    let { job } = askAll(start());
    let handed = handOver(job);
    job = handed.job;
    assert.deepEqual(handed.songs, [{ source: "library", trackId: 1 }]);

    const crush = yt("c", "Instant Crush", {
      artists: ["Daft Punk", "Julian Casablancas"],
      durationMs: 337_000,
    });
    job = importSearchAnswered(job, QUERIES[1] ?? "", { ok: true, songs: [crush] }, 0);
    handed = handOver(job);
    job = handed.job;
    assert.deepEqual(handed.songs, [], "Within is still searched");

    const within = yt("w", "Within", { durationMs: 228_000 });
    job = importSearchAnswered(job, QUERIES[0] ?? "", { ok: true, songs: [within] }, 0);
    handed = handOver(job);
    job = handed.job;
    assert.deepEqual(handed.songs, [
      { source: "stream", song: within },
      { source: "stream", song: crush },
    ]);
    assert.equal(
      job.added,
      4,
      "the song without an artist is settled too (Within's second listing was left out)",
    );

    assert.deepEqual(askAll(job).asked, ["Fragments of Time Daft Punk"]);
  });

  test("a song YouTube Music hasn't is passed over, and the import is done once every song is settled", () => {
    let { job } = askAll(start());
    for (const query of QUERIES) {
      job = importSearchAnswered(job, query, { ok: true, songs: [yt("x", "Something Else")] }, 0);
    }
    job = askAll(job).job;
    job = importSearchAnswered(job, "Fragments of Time Daft Punk", { ok: true, songs: [] }, 0);
    const handed = handOver(job);
    assert.deepEqual(handed.songs, [{ source: "library", trackId: 1 }]);
    assert.equal(handed.job.state.kind, "done");
    assert.equal(askAll(handed.job).step.kind, "none");
  });

  test("a refused search pauses the searching, then is asked again, longer each time it's refused", () => {
    let { job } = askAll(start());
    job = importSearchAnswered(job, QUERIES[0] ?? "", { ok: false, reason: "failed" }, 1000);
    assert.deepEqual(askAll(job, 2999).step, { kind: "wait", untilMs: 3000 });
    let next = askAll(job, 3000);
    assert.deepEqual(next.asked, [QUERIES[0]]);
    job = importSearchAnswered(next.job, QUERIES[0] ?? "", { ok: false, reason: "failed" }, 3000);
    assert.deepEqual(askAll(job, 3000).step, { kind: "wait", untilMs: 8000 });
    next = askAll(job, 8000);
    job = importSearchAnswered(next.job, QUERIES[0] ?? "", { ok: true, songs: [] }, 8000);
    job = importSearchAnswered(job, QUERIES[1] ?? "", { ok: false, reason: "failed" }, 8000);
    assert.deepEqual(
      askAll(job, 8000).step,
      { kind: "wait", untilMs: 10_000 },
      "a search answered starts over",
    );
  });

  test("YouTube Music refusing for minutes pauses the import longer each time, then it goes on from that song", () => {
    let { job } = askAll(start());
    let now = 0;
    const pauses = [2, 5, 10, 20, 60, 120, 300, 600, 900].map((seconds) => seconds * 1000);
    for (const pause of pauses) {
      job = importSearchAnswered(job, QUERIES[0] ?? "", { ok: false, reason: "failed" }, now);
      assert.equal(job.state.kind, "importing");
      assert.deepEqual(askAll(job, now).step, { kind: "wait", untilMs: now + pause });
      now += pause;
      const again = askAll(job, now);
      assert.deepEqual(again.asked, [QUERIES[0]], "the same search is asked again, first");
      job = again.job;
    }
    const within = yt("w", "Within", { durationMs: 228_000 });
    job = importSearchAnswered(job, QUERIES[0] ?? "", { ok: true, songs: [within] }, now);
    for (const query of QUERIES.slice(1)) {
      job = importSearchAnswered(job, query, { ok: true, songs: [] }, now);
    }
    assert.deepEqual(handOver(job).songs, [
      { source: "library", trackId: 1 },
      { source: "stream", song: within },
    ]);
    assert.deepEqual(askAll(job, now).asked, ["Fragments of Time Daft Punk"], "nothing skipped");
  });

  test("the same search refused for over half an hour stops the import, keeping the songs found", () => {
    let { job } = askAll(start());
    let now = 0;
    for (let refusal = 0; refusal < 10; refusal += 1) {
      job = importSearchAnswered(job, QUERIES[0] ?? "", { ok: false, reason: "failed" }, now);
      now += 15 * 60_000;
      job = askAll(job, now).job;
    }
    assert.deepEqual(job.state, { kind: "stopped", reason: "searchFailed" });
    assert.equal(askAll(job, now).step.kind, "none");
    assert.deepEqual(handOver(job).songs, [{ source: "library", trackId: 1 }]);
  });

  test("offline, or with YT Music turned off, the import stops at once", () => {
    for (const reason of ["offline", "disabled"] as const) {
      const { job } = askAll(start());
      const stopped = importSearchAnswered(job, QUERIES[2] ?? "", { ok: false, reason }, 0);
      assert.deepEqual(stopped.state, { kind: "stopped", reason });
      assert.equal(askAll(stopped).step.kind, "none");
      const within = yt("w", "Within", { durationMs: 228_000 });
      const answered = importSearchAnswered(
        stopped,
        QUERIES[0] ?? "",
        { ok: true, songs: [within] },
        0,
      );
      assert.deepEqual(
        handOver(answered).songs,
        [
          { source: "library", trackId: 1 },
          { source: "stream", song: within },
        ],
        "a search asked before it stopped still finds its song",
      );
    }
  });
});

/** Songs the Library hasn't, each its own search. */
const many = (count: number, from = 0): SpotifySong[] =>
  Array.from({ length: count }, (_, n) => spotify(`Song ${from + n}`));

/** A Spotify import of [songs] into playlist 7. */
const startBig = (songs: readonly SpotifySong[]) =>
  startPlaylistImport(planLinkImport(spotifyPlaylist(songs), library), {
    playlistId: 7,
    name: "Big",
  });

/** Asks and answers (not found) every search allowed at [now]; the step it then stops at. */
const runAt = <S extends YtSong>(
  job: PlaylistImport<S>,
  now: number,
  searches: SpotifySearchPacing,
) => {
  let current = job;
  let pacing = searches;
  let asked = 0;
  for (;;) {
    const next = askAll(current, now, pacing);
    pacing = next.searches;
    current = next.job;
    if (next.asked.length === 0) return { job: current, searches: pacing, asked, step: next.step };
    asked += next.asked.length;
    for (const query of next.asked) {
      current = importSearchAnswered(current, query, { ok: true, songs: [] }, now);
    }
    current = handOver(current).job;
  }
};

const NONE = readSpotifySearchPacing(null);

/** Playlist 7's import line at [now]. */
const importLine = (job: PlaylistImport<YtSong>, now: number, searches: SpotifySearchPacing) =>
  playlistImportView([job], 7, now, searches)?.line;

describe("a large Spotify playlist's searches, paced under YouTube Music's limit", () => {
  test("at most 1,000 searches go in any 15 minutes, then the import waits and goes on", () => {
    const first = runAt(startBig(many(2500)), 0, NONE);
    assert.equal(first.asked, 1000);
    assert.deepEqual(first.step, { kind: "wait", untilMs: 15 * 60_000 });
    assert.equal(runAt(first.job, 15 * 60_000 - 1, first.searches).asked, 0);
    const second = runAt(first.job, 15 * 60_000, first.searches);
    assert.equal(second.asked, 1000);
    const third = runAt(second.job, 30 * 60_000, second.searches);
    assert.equal(third.asked, 500);
    assert.equal(third.job.state.kind, "done");
    assert.equal(third.job.added, 2500, "every song settled, none skipped");
  });

  test("the Library's songs need no search and spend none of the allowance", () => {
    const songs = [
      spotify("Giorgio by Moroder", { durationMs: 544_000 }),
      ...many(999),
      spotify("Touch", { durationMs: 498_000 }),
      ...many(5, 999),
    ];
    const run = runAt(startBig(songs), 0, NONE);
    assert.equal(run.asked, 1000);
    assert.equal(run.job.added, 1002, "the Library's songs settled along the way");
    assert.deepEqual(run.step, { kind: "wait", untilMs: 15 * 60_000 });
  });

  test("the allowance is shared by the imports in turn and kept while Wave is closed", () => {
    const first = runAt(startBig(many(600)), 0, NONE);
    assert.equal(first.job.state.kind, "done");
    const kept = readSpotifySearchPacing(writeSpotifySearchPacing(first.searches));
    const second = runAt(startBig(many(600, 600)), 60_000, kept);
    assert.equal(second.asked, 400);
    assert.deepEqual(second.step, { kind: "wait", untilMs: 15 * 60_000 });
    const later = readSpotifySearchPacing(writeSpotifySearchPacing(second.searches));
    assert.equal(runAt(startBig(many(1200, 1200)), 16 * 60_000, later).asked, 1000);
  });
});

describe("how long a Spotify import has left", () => {
  test("the page's line says roughly how long the searches still take, at about 6 a second and 1,000 in 15 minutes", () => {
    assert.equal(
      importLine(startBig(many(8)), 0, NONE),
      "Importing 0 of 8 songs · less than a minute left",
    );
    assert.equal(
      importLine(startBig(many(800)), 0, NONE),
      "Importing 0 of 800 songs · about 2 min left",
    );
    assert.equal(
      importLine(startBig(many(3000)), 0, NONE),
      "Importing 0 of 3,000 songs · about 33 min left",
    );
    assert.equal(
      importLine(startBig(many(10_000)), 0, NONE),
      "Importing 0 of 10,000 songs · about 2 h 18 min left",
    );
  });

  test("searches already spent this window, or a pause after a refusal, add their wait", () => {
    let { job, searches } = askAll(startBig(many(990)), 0);
    job = importSearchAnswered(job, "Song 0 Daft Punk", { ok: false, reason: "failed" }, 0);
    assert.equal(importLine(job, 0, searches), "Importing 0 of 990 songs · about 3 min left");
    const spent = { searchesAt: Array.from({ length: 1000 }, () => 0) };
    assert.equal(
      importLine(startBig(many(10)), 60_000, spent),
      "Importing 0 of 10 songs · about 14 min left",
    );
  });

  test("a YouTube Music playlist import, or one waiting for its last answers, says no time", () => {
    const { job, searches } = askAll(startBig(many(3)), 0);
    assert.equal(importLine(job, 0, searches), "Importing 0 of 3 songs");
    const ytJob = startPlaylistImport(planLinkImport(ytPlaylist([yt("b", "Within")]), library), {
      playlistId: 7,
      name: "Mix",
    });
    assert.equal(importLine(ytJob, 0, NONE), "Importing 1 of 1 song");
  });
});

describe("the imports waiting their turn", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Untitled", { artists: [] }),
    spotify("Doin' it Right", { artists: ["Daft Punk", "Panda Bear"], durationMs: 251_000 }),
  ];
  const plan = planLinkImport(spotifyPlaylist(songs), library);
  const first = startPlaylistImport(plan, { playlistId: 7, name: "Late Night" });
  const second = startPlaylistImport(plan, { playlistId: 8, name: "Late Night 2" });
  const WITHIN = "Within Daft Punk";
  const DOIN = "Doin' it Right Daft Punk Panda Bear";
  const view = (imports: readonly PlaylistImport<YtSong>[], playlistId: number) => {
    const shown = playlistImportView(imports, playlistId, 0, readSpotifySearchPacing(null));
    return shown && [shown.line, shown.canCancel, shown.canRetry];
  };

  test("a second import waits for the first, and goes on once the first is done", () => {
    let imports = queuePlaylistImport(queuePlaylistImport([], first), second);
    assert.equal(importTurn(imports)?.playlistId, 7);
    assert.deepEqual(view(imports, 7), [
      "Importing 2 of 4 songs · less than a minute left",
      true,
      false,
    ]);
    assert.deepEqual(view(imports, 8), ["Waiting to import 4 songs", true, false]);
    assert.deepEqual(playlistImportProgress(imports), {
      title: "Importing Late Night",
      detail: "2 of 4 songs · 1 more playlist waiting",
      done: 2,
      total: 4,
    });

    const within = yt("w", "Within", { durationMs: 228_000 });
    let { job } = askAll(first);
    job = importSearchAnswered(job, WITHIN, { ok: true, songs: [within] }, 0);
    job = importSearchAnswered(job, DOIN, { ok: true, songs: [] }, 0);
    imports = updatePlaylistImport(imports, handOver(job).job);
    assert.equal(importTurn(imports)?.playlistId, 8);
    assert.deepEqual(view(imports, 7), ["2 songs weren't found", false, false]);
    assert.deepEqual(playlistImportView(imports, 7, 0, readSpotifySearchPacing(null))?.notFound, {
      title: "2 songs weren't found",
      message:
        "Late Night was imported without them:\n\nUntitled · Unknown Artist\nDoin' it Right · Daft Punk & Panda Bear",
    });
    assert.equal(
      playlistImportView(withoutPlaylistImport(imports, 7), 7, 0, readSpotifySearchPacing(null)),
      null,
      "dismissed",
    );
  });

  test("an import done with every song found leaves nothing to show", () => {
    const ytJob = startPlaylistImport(planLinkImport(ytPlaylist([yt("b", "Within")]), library), {
      playlistId: 9,
      name: "Mix",
    });
    const imports = updatePlaylistImport(queuePlaylistImport([], ytJob), handOver(ytJob).job);
    assert.deepEqual(imports, []);
  });

  test("Cancel lets the next import go on; importing into a playlist again replaces its import", () => {
    const imports = queuePlaylistImport(queuePlaylistImport([], first), second);
    assert.equal(importTurn(withoutPlaylistImport(imports, 7))?.playlistId, 8);
    const again = queuePlaylistImport(imports, { ...first, name: "Again" });
    assert.deepEqual(
      again.map((job) => job.name),
      ["Late Night 2", "Again"],
    );
  });

  test("stopped, the page says why and offers Try Again, which puts it behind the others", () => {
    for (const [reason, line] of [
      ["offline", "Import paused: you're offline."],
      ["disabled", "Import paused: YT Music is off in Settings."],
      ["failed", "Import paused: YouTube Music stopped answering."],
    ] as const) {
      let job = askAll(first).job;
      const refusals = reason === "failed" ? 10 : 1;
      for (let refusal = 0; refusal < refusals; refusal += 1) {
        const now = refusal * 15 * 60_000;
        job = importSearchAnswered(job, WITHIN, { ok: false, reason }, now);
        job = askAll(job, now + 15 * 60_000).job;
      }
      let imports = updatePlaylistImport(queuePlaylistImport([first], second), job);
      assert.equal(importTurn(imports)?.playlistId, 8, "a stopped import steps aside");
      assert.deepEqual(view(imports, 7), [line, true, true], reason);
      assert.equal(playlistImportProgress(imports)?.title, "Importing Late Night 2");

      imports = retryPlaylistImport(imports, 7);
      assert.deepEqual(
        imports.map((queued) => queued.playlistId),
        [8, 7],
      );
      assert.deepEqual(view(imports, 7), ["Waiting to import 4 songs", true, false]);
      const retried = withoutPlaylistImport(imports, 8)[0];
      assert.ok(retried);
      assert.deepEqual(askAll(retried).asked, [WITHIN, DOIN], "asked again at once");
    }
  });
});

describe("imports kept while Wave is closed", () => {
  const songs = [
    spotify("Giorgio by Moroder", { durationMs: 544_000 }),
    spotify("Within", { durationMs: 228_000 }),
    spotify("Doin' it Right", { artists: ["Daft Punk", "Panda Bear"], durationMs: 251_000 }),
    spotify("Fragments of Time", { album: null, durationMs: 279_000 }),
  ];
  const plan = planLinkImport(spotifyPlaylist(songs), library);
  const within = yt("w", "Within", { durationMs: 228_000 });

  test("read back when Wave starts again, each import goes on from where it got to", () => {
    let going = askAll(startPlaylistImport(plan, { playlistId: 7, name: "Late Night" })).job;
    going = importSearchAnswered(going, "Within Daft Punk", { ok: true, songs: [within] }, 0);
    going = importSearchAnswered(
      going,
      "Fragments of Time Daft Punk",
      { ok: false, reason: "failed" },
      0,
    );
    going = handOver(going).job;
    let stopped = askAll(startPlaylistImport(plan, { playlistId: 8, name: "Late Night 2" })).job;
    stopped = importSearchAnswered(
      stopped,
      "Within Daft Punk",
      { ok: false, reason: "offline" },
      0,
    );
    stopped = handOver(stopped).job;

    const read = readPlaylistImports(writePlaylistImports([going, stopped]));
    assert.deepEqual(
      read.map((job) => [job.playlistId, job.name, job.added, job.state.kind]),
      [
        [7, "Late Night", 2, "importing"],
        [8, "Late Night 2", 1, "importing"],
      ],
    );
    const [first] = read;
    assert.ok(first);
    assert.deepEqual(first.songs, songs);
    assert.deepEqual(
      askAll(first, 0).asked,
      ["Doin' it Right Daft Punk Panda Bear", "Fragments of Time Daft Punk"],
      "the searches unanswered when Wave closed are asked again at once",
    );
    assert.deepEqual(first.finds[1], { kind: "ytMusic", song: { ...within, albumId: null } });
    assert.deepEqual(handOver(first).songs, [], "the songs given before aren't given again");
  });

  test("an import done with songs not found is kept until dismissed", () => {
    let job = askAll(startPlaylistImport(plan, { playlistId: 7, name: "Late Night" })).job;
    for (const query of [
      "Within Daft Punk",
      "Doin' it Right Daft Punk Panda Bear",
      "Fragments of Time Daft Punk",
    ]) {
      job = importSearchAnswered(job, query, { ok: true, songs: [] }, 0);
    }
    job = handOver(job).job;
    const read = readPlaylistImports(writePlaylistImports([job]));
    assert.equal(
      playlistImportView(read, 7, 0, readSpotifySearchPacing(null))?.line,
      "3 songs weren't found",
    );
  });

  test("nothing kept, or nothing readable, is no import", () => {
    assert.deepEqual(readPlaylistImports(null), []);
    assert.deepEqual(readPlaylistImports("{"), []);
    assert.deepEqual(readPlaylistImports('{"imports":[{"playlistId":"7"}]}'), []);
  });
});

/** What the notification says of [job]'s progress. */
const progress = (job: PlaylistImport<YtSong>) => playlistImportProgress([job])?.detail;

describe("a Spotify import as its answers arrive, in any order", () => {
  const songs = [
    spotify("One", { durationMs: 200_000 }),
    spotify("Two", { durationMs: 210_000 }),
    spotify("Touch", { durationMs: 498_000 }),
    spotify("Two", { album: "Deluxe", durationMs: 210_000 }),
    spotify("Four", { durationMs: 230_000 }),
    spotify("Five", { durationMs: 240_000 }),
  ];
  const one = yt("o", "One", { durationMs: 200_000 });
  const two = yt("t", "Two", { durationMs: 210_000 });
  const four = yt("f", "Four", { durationMs: 230_000 });
  const five = yt("v", "Five", { durationMs: 240_000 });
  const start = () =>
    startPlaylistImport(planLinkImport(spotifyPlaylist(songs), library), {
      playlistId: 7,
      name: "Late Night",
    });

  test("a song listed again on another album is searched once, and its answer settles both", () => {
    const { asked } = askAll(start());
    assert.deepEqual(asked, ["One Daft Punk", "Two Daft Punk", "Four Daft Punk", "Five Daft Punk"]);
  });

  test("answers arriving last first give the playlist nothing until the first song is settled, then all in order, each once", () => {
    let { job } = askAll(start());
    assert.equal(progress(job), "1 of 6 songs");
    const given: unknown[] = [];
    for (const [query, found, settled] of [
      ["Five Daft Punk", five, "2 of 6 songs"],
      ["Four Daft Punk", four, "3 of 6 songs"],
      ["Two Daft Punk", two, "5 of 6 songs"],
    ] as const) {
      job = importSearchAnswered(job, query, { ok: true, songs: [found] }, 0);
      assert.equal(progress(job), settled);
      const handed = handOver(job);
      job = handed.job;
      given.push(...handed.songs);
    }
    assert.deepEqual(given, [], "One is still searched");
    assert.equal(job.added, 0);
    job = importSearchAnswered(job, "One Daft Punk", { ok: true, songs: [one] }, 0);
    const handed = handOver(job);
    assert.deepEqual(handed.songs, [
      { source: "stream", song: one },
      { source: "stream", song: two },
      { source: "library", trackId: 2 },
      { source: "stream", song: four },
      { source: "stream", song: five },
    ]);
    assert.equal(handed.job.added, 6);
    assert.equal(handed.job.state.kind, "done");
    assert.deepEqual(importAdditions(handed.job).songs, []);
  });

  test("a song found again by another search, before or after the first was given, isn't given twice", () => {
    const listed = [
      spotify("One", { durationMs: 200_000 }),
      spotify("Two", { durationMs: 210_000 }),
      spotify("One", { artists: ["Daft Punk", "Someone"], durationMs: 200_000 }),
      spotify("Four", { durationMs: 230_000 }),
      spotify("One", { artists: ["Daft Punk", "Another"], durationMs: 200_000 }),
    ];
    let { job, asked } = askAll(
      startPlaylistImport(planLinkImport(spotifyPlaylist(listed), library), {
        playlistId: 7,
        name: "Again",
      }),
    );
    assert.deepEqual(asked, [
      "One Daft Punk",
      "Two Daft Punk",
      "One Daft Punk Someone",
      "Four Daft Punk",
    ]);
    job = importSearchAnswered(job, "One Daft Punk Someone", { ok: true, songs: [one] }, 0);
    job = importSearchAnswered(job, "One Daft Punk", { ok: true, songs: [one] }, 0);
    let handed = handOver(job);
    assert.deepEqual(handed.songs, [{ source: "stream", song: one }]);
    job = askAll(handed.job).job;
    job = importSearchAnswered(job, "One Daft Punk Another", { ok: true, songs: [one] }, 0);
    job = importSearchAnswered(job, "Two Daft Punk", { ok: true, songs: [two] }, 0);
    handed = handOver(job);
    assert.deepEqual(handed.songs, [{ source: "stream", song: two }]);
    job = importSearchAnswered(handed.job, "Four Daft Punk", { ok: true, songs: [] }, 0);
    handed = handOver(job);
    assert.deepEqual(handed.songs, [], "the second One was given already, Four wasn't found");
    assert.equal(handed.job.state.kind, "done");
    assert.equal(playlistImportView([handed.job], 7, 0, NONE)?.line, "1 song wasn't found");
  });

  test("an earlier state of an import stays as it was after later answers, and two imports of one plan stay apart", () => {
    const plan = planLinkImport(spotifyPlaylist(songs), library);
    const asked = askAll(startPlaylistImport(plan, { playlistId: 7, name: "A" })).job;
    const other = askAll(startPlaylistImport(plan, { playlistId: 8, name: "B" })).job;
    const answered = importSearchAnswered(asked, "One Daft Punk", { ok: true, songs: [one] }, 0);
    const later = importSearchAnswered(answered, "Two Daft Punk", { ok: true, songs: [two] }, 0);
    const elsewhere = importSearchAnswered(other, "One Daft Punk", { ok: true, songs: [] }, 0);
    assert.deepEqual(
      [asked, answered, later, other, elsewhere].map((job) => [
        importAdditions(job).through,
        progress(job),
        playlistImportView([job], job.playlistId, 0, NONE)?.line,
      ]),
      [
        [0, "1 of 6 songs", "Importing 1 of 6 songs"],
        [1, "2 of 6 songs", "Importing 2 of 6 songs"],
        [4, "4 of 6 songs", "Importing 4 of 6 songs"],
        [0, "1 of 6 songs", "Importing 1 of 6 songs"],
        [1, "2 of 6 songs", "Importing 2 of 6 songs"],
      ],
    );
    assert.deepEqual(importAdditions(answered).songs, [{ source: "stream", song: one }]);
    assert.deepEqual(importAdditions(elsewhere).songs, []);
    assert.deepEqual(askAll(answered).asked, [], "Two, Four and Five are still asked");
    assert.deepEqual(askAll(elsewhere).asked, []);
  });

  test("resumed after Wave closed mid-way, it asks the unanswered searches again in order and gives nothing twice", () => {
    let { job } = askAll(start());
    job = importSearchAnswered(job, "Four Daft Punk", { ok: true, songs: [four] }, 0);
    job = importSearchAnswered(job, "One Daft Punk", { ok: true, songs: [one] }, 0);
    let handed = handOver(job);
    assert.deepEqual(handed.songs, [{ source: "stream", song: one }]);
    const [read] = readPlaylistImports(writePlaylistImports([handed.job]));
    assert.ok(read);
    assert.equal(read.added, 1);
    assert.equal(progress(read), "3 of 6 songs");
    assert.equal(importLine(read, 0, NONE), "Importing 3 of 6 songs · less than a minute left");
    const again = askAll(read);
    assert.deepEqual(again.asked, ["Two Daft Punk", "Five Daft Punk"]);
    job = importSearchAnswered(again.job, "Five Daft Punk", { ok: true, songs: [five] }, 0);
    job = importSearchAnswered(job, "Two Daft Punk", { ok: true, songs: [two] }, 0);
    handed = handOver(job);
    assert.deepEqual(
      handed.songs.map((song) => (song.source === "library" ? song.trackId : song.song.videoId)),
      ["t", 2, "f", "v"],
    );
    assert.equal(handed.job.state.kind, "done");
  });

  test("cancelled mid-way, it's gone, and the next import goes on", () => {
    let { job } = askAll(start());
    job = importSearchAnswered(job, "Two Daft Punk", { ok: true, songs: [two] }, 0);
    const next = startPlaylistImport(planLinkImport(spotifyPlaylist(songs), library), {
      playlistId: 8,
      name: "Next",
    });
    const imports = withoutPlaylistImport(queuePlaylistImport([job], next), 7);
    assert.equal(playlistImportView(imports, 7, 0, NONE), null);
    assert.equal(importTurn(imports)?.playlistId, 8);
    assert.equal(playlistImportProgress(imports)?.detail, "1 of 6 songs");
  });
});
