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
  type PlaylistImport,
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
  });
});

/** Takes every search the import asks now, until it waits for answers. */
const askAll = <S extends YtSong>(job: PlaylistImport<S>, now = 0) => {
  const asked: string[] = [];
  let current = job;
  for (;;) {
    const next = nextImportStep(current, now);
    current = next.job;
    if (next.step.kind !== "search") return { job: current, asked, step: next.step };
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
    assert.equal(job.added, 5, "the song without an artist and Within's second listing are settled too");

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
    assert.deepEqual(askAll(job, 8000).step, { kind: "wait", untilMs: 10_000 }, "a search answered starts over");
  });

  test("the same search refused a fifth time stops the import, keeping the songs found", () => {
    let { job } = askAll(start());
    let now = 0;
    for (let refusal = 0; refusal < 5; refusal += 1) {
      job = importSearchAnswered(job, QUERIES[0] ?? "", { ok: false, reason: "failed" }, now);
      now += 60_000;
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
      const answered = importSearchAnswered(stopped, QUERIES[0] ?? "", { ok: true, songs: [within] }, 0);
      assert.deepEqual(
        handOver(answered).songs,
        [{ source: "library", trackId: 1 }, { source: "stream", song: within }],
        "a search asked before it stopped still finds its song",
      );
    }
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
    const shown = playlistImportView(imports, playlistId);
    return shown && [shown.line, shown.canCancel, shown.canRetry];
  };

  test("a second import waits for the first, and goes on once the first is done", () => {
    let imports = queuePlaylistImport(queuePlaylistImport([], first), second);
    assert.equal(importTurn(imports)?.playlistId, 7);
    assert.deepEqual(view(imports, 7), ["Importing 2 of 4 songs", true, false]);
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
    assert.deepEqual(playlistImportView(imports, 7)?.notFound, {
      title: "2 songs weren't found",
      message:
        "Late Night was imported without them:\n\nUntitled · Unknown Artist\nDoin' it Right · Daft Punk & Panda Bear",
    });
    assert.equal(playlistImportView(withoutPlaylistImport(imports, 7), 7), null, "dismissed");
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
      const refusals = reason === "failed" ? 5 : 1;
      for (let refusal = 0; refusal < refusals; refusal += 1) {
        const now = refusal * 60_000;
        job = importSearchAnswered(job, WITHIN, { ok: false, reason }, now);
        job = askAll(job, now + 60_000).job;
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
    going = importSearchAnswered(going, "Fragments of Time Daft Punk", { ok: false, reason: "failed" }, 0);
    going = handOver(going).job;
    let stopped = askAll(startPlaylistImport(plan, { playlistId: 8, name: "Late Night 2" })).job;
    stopped = importSearchAnswered(stopped, "Within Daft Punk", { ok: false, reason: "offline" }, 0);
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
    for (const query of ["Within Daft Punk", "Doin' it Right Daft Punk Panda Bear", "Fragments of Time Daft Punk"]) {
      job = importSearchAnswered(job, query, { ok: true, songs: [] }, 0);
    }
    job = handOver(job).job;
    const read = readPlaylistImports(writePlaylistImports([job]));
    assert.equal(playlistImportView(read, 7)?.line, "3 songs weren't found");
  });

  test("nothing kept, or nothing readable, is no import", () => {
    assert.deepEqual(readPlaylistImports(null), []);
    assert.deepEqual(readPlaylistImports("{"), []);
    assert.deepEqual(readPlaylistImports('{"imports":[{"playlistId":"7"}]}'), []);
  });
});
