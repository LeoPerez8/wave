import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_DOWNLOAD_PAUSE,
  albumDownloadOrigin,
  applyJournalChanges,
  catalogueOf,
  downloadingList,
  moveDownloadGroup,
  moveDownloadInGroup,
  moveQueuedJobs,
  pauseDownloadGroup,
  playlistDownloadOrigin,
  queuedDownloadLines,
  sameDownloadingList,
  sameQueuedDownload,
} from "./index.ts";
import type { DownloadOrigin, YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const job = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

const roadTrip: DownloadOrigin = { kind: "playlist", id: "7", name: "Road Trip" };
const focus: DownloadOrigin = { kind: "playlist", id: "9", name: "Focus" };
const mix: DownloadOrigin = { kind: "mix", id: "mix-1", name: "Discover Mix 1" };

/** Each group as [name, line, waiting ids]. */
const groupsOf = (jobs: readonly YtDownloadJournalJob[]) =>
  downloadingList(jobs).groups.map((group) => [
    group.name,
    group.line,
    group.queued.map((queued) => queued.id),
  ]);

describe("Settings › Downloads › Downloading: waiting songs grouped by where they were asked from", () => {
  test("two playlists' songs wait in two groups, each named after its playlist", () => {
    const jobs = [
      job("a", { origin: roadTrip }),
      job("b", { origin: roadTrip }),
      job("c", { origin: focus }),
      job("d", { origin: focus }),
    ];
    assert.deepEqual(groupsOf(jobs), [
      ["Road Trip", "2 songs left", ["a", "b"]],
      ["Focus", "2 songs left", ["c", "d"]],
    ]);
  });

  test("songs asked for on their own, and jobs from before sources, wait under Songs", () => {
    // A job queued before this update has no origin at all.
    const jobs = [job("old"), job("a", { origin: mix }), job("own", { origin: null })];
    assert.deepEqual(groupsOf(jobs), [
      ["Songs", "2 songs left", ["old", "own"]],
      ["Discover Mix 1", "1 song left", ["a"]],
    ]);
    assert.equal(downloadingList(jobs).groups[0]?.origin, null);
    assert.deepEqual(downloadingList(jobs).groups[1]?.origin, mix);
  });

  test("the songs downloading now stay at the top, outside the groups", () => {
    const jobs = [
      job("a", { origin: roadTrip, phase: "transferring", received: 42, total: 100 }),
      job("b", { origin: roadTrip }),
      job("c", { origin: focus, phase: "tagging" }),
    ];
    const list = downloadingList(jobs);
    assert.deepEqual(
      list.downloading.map((row) => [row.id, row.line]),
      [
        ["a", "Downloading · 42%"],
        ["c", "Saving to the Library"],
      ],
    );
    // A group counts its songs downloading too, and stays until its last one is done.
    assert.deepEqual(groupsOf(jobs), [
      ["Focus", "1 song left", []],
      ["Road Trip", "2 songs left", ["b"]],
    ]);
  });

  test("the section's counts are the queue's: songs waiting their turn to be saved aren't downloading", () => {
    const jobs = [
      job("a", { origin: roadTrip, phase: "transferring" }),
      job("b", { origin: roadTrip, phase: "awaitingPublication" }),
      job("c", { origin: roadTrip, phase: "awaitingPublication" }),
      job("d", { origin: focus, phase: "publishing" }),
      job("e", { origin: focus }),
    ];
    assert.deepEqual(downloadingList(jobs).counts, { downloading: 1, saving: 3, waiting: 1 });
  });

  test("groups come in queue order: the one whose next song starts soonest first", () => {
    // The journal lists jobs in the order its queue starts them.
    const jobs = [
      job("f1", { origin: focus, phase: "preparing" }),
      job("r1", { origin: roadTrip }),
      job("f2", { origin: focus }),
      job("s1"),
      job("r2", { origin: roadTrip }),
    ];
    assert.deepEqual(groupsOf(jobs), [
      ["Road Trip", "2 songs left", ["r1", "r2"]],
      ["Focus", "2 songs left", ["f2"]],
      ["Songs", "1 song left", ["s1"]],
    ]);
  });

  test("a song both playlists asked for shows once, in the group of the first that asked", () => {
    // The journal keeps one job per recording, with the origin of its first request, and
    // adds a second playlist's own result for it as an alias.
    const jobs = [
      job("a", { origin: roadTrip }),
      job("shared", { origin: roadTrip, aliases: [song("shared-focus")] }),
      job("c", { origin: focus }),
    ];
    assert.deepEqual(groupsOf(jobs), [
      ["Road Trip", "2 songs left", ["a", "shared"]],
      ["Focus", "1 song left", ["c"]],
    ]);
  });

  test("the same playlist is one group, keyed by what it is rather than its name", () => {
    const renamed: DownloadOrigin = { ...roadTrip, name: "Road Trip 2026" };
    const album: DownloadOrigin = { kind: "album", id: "7", name: "Road Trip" };
    const groups = downloadingList([
      job("a", { origin: roadTrip }),
      job("b", { origin: renamed }),
      job("c", { origin: album }),
    ]).groups;
    assert.deepEqual(
      groups.map((group) => [group.name, group.queued.map((queued) => queued.id)]),
      [
        ["Road Trip", ["a", "b"]],
        ["Road Trip", ["c"]],
      ],
    );
    assert.equal(new Set(groups.map((group) => group.key)).size, 2);
  });

  test("a Library playlist or album asked from anywhere (its page, its menu, an import) is the same source", () => {
    const fromPage = playlistDownloadOrigin({ id: 7, name: "Road Trip" });
    const fromImport = playlistDownloadOrigin({ id: 7, name: "Road Trip" });
    assert.deepEqual(fromPage, roadTrip);
    assert.deepEqual(fromImport, fromPage);
    assert.deepEqual(albumDownloadOrigin({ id: 3, title: "Dummy" }), {
      kind: "album",
      id: "3",
      name: "Dummy",
    });
  });

  test("a group is gone once its last song finishes, fails or is cancelled", () => {
    const jobs = [
      job("a", { origin: roadTrip, phase: "completed", acknowledged: true, saved: { path: "/a" } }),
      job("b", { origin: roadTrip, phase: "failed", reason: "offline" }),
      job("c", { origin: roadTrip, phase: "cancelled" }),
      job("d", { origin: focus }),
    ];
    assert.deepEqual(groupsOf(jobs), [["Focus", "1 song left", ["d"]]]);
    assert.deepEqual(downloadingList([]), {
      downloading: [],
      counts: { downloading: 0, saving: 0, waiting: 0 },
      groups: [],
    });
  });
});

/** The journal's waiting jobs, in the order its queue starts them. */
const startOrder = (jobs: readonly YtDownloadJournalJob[]) =>
  jobs.filter((entry) => entry.phase === "queued").map((entry) => entry.id);

describe("Settings › Downloads › Downloading: dragging changes what downloads first", () => {
  test("dragging playlist B's header above A's makes B's songs start before A's", () => {
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("a2", { origin: roadTrip }),
      job("b1", { origin: focus }),
      job("b2", { origin: focus }),
    ];
    const moved = moveQueuedJobs(jobs, moveDownloadGroup(downloadingList(jobs), 1, 0));
    assert.deepEqual(startOrder(moved), ["b1", "b2", "a1", "a2"]);
    assert.deepEqual(
      groupsOf(moved).map(([name]) => name),
      ["Focus", "Road Trip"],
    );
  });

  test("dragging a song to the top of its group makes it the next of that group to start", () => {
    // The two playlists' songs were asked for in turns.
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("b1", { origin: focus }),
      job("a2", { origin: roadTrip }),
      job("b2", { origin: focus }),
      job("a3", { origin: roadTrip }),
    ];
    const [roadTripGroup] = downloadingList(jobs).groups;
    assert.ok(roadTripGroup !== undefined);
    const moved = moveQueuedJobs(jobs, moveDownloadInGroup(roadTripGroup, 2, 0));
    // Focus's songs keep their places.
    assert.deepEqual(startOrder(moved), ["a3", "b1", "a1", "b2", "a2"]);
    assert.deepEqual(groupsOf(moved), [
      ["Road Trip", "3 songs left", ["a3", "a1", "a2"]],
      ["Focus", "2 songs left", ["b1", "b2"]],
    ]);
  });

  test("a song can't be dropped into another group: past its group's end it stays last in it", () => {
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("a2", { origin: roadTrip }),
      job("b1", { origin: focus }),
    ];
    const [roadTripGroup] = downloadingList(jobs).groups;
    assert.ok(roadTripGroup !== undefined);
    const moved = moveQueuedJobs(jobs, moveDownloadInGroup(roadTripGroup, 0, 5));
    assert.deepEqual(groupsOf(moved), [
      ["Road Trip", "2 songs left", ["a2", "a1"]],
      ["Focus", "1 song left", ["b1"]],
    ]);
  });

  test("a song that started while the drag was on keeps its place; the rest still move", () => {
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("a2", { origin: roadTrip }),
      job("b1", { origin: focus }),
      job("b2", { origin: focus }),
    ];
    const order = moveDownloadGroup(downloadingList(jobs), 1, 0);
    const meanwhile = jobs.map((entry) =>
      entry.id === "a1" ? { ...entry, phase: "preparing" as const } : entry,
    );
    const moved = moveQueuedJobs(meanwhile, order);
    assert.deepEqual(
      moved.map((entry) => entry.id),
      ["a1", "b1", "b2", "a2"],
    );
    assert.deepEqual(
      downloadingList(moved).downloading.map((row) => row.id),
      ["a1"],
    );
  });
});

describe("Downloading groups while following the journal by its changes", () => {
  test("a job's source survives the changes it's followed by, so its group stays", () => {
    const first = applyJournalChanges([], {
      revision: 2,
      jobs: [job("a", { origin: roadTrip }), job("b", { origin: focus })],
      ids: ["a", "b"],
    });
    // Progress on "b" comes as that job alone, still carrying where it was asked from.
    const started = applyJournalChanges(first, {
      revision: 3,
      jobs: [job("b", { origin: focus, phase: "transferring", received: 10, total: 100 })],
      ids: null,
    });
    assert.deepEqual(groupsOf(started), [
      ["Focus", "1 song left", []],
      ["Road Trip", "1 song left", ["a"]],
    ]);
    // Another playlist's Retry Failed moves "a" to the end of the queue under its new source.
    const retried = applyJournalChanges(started, {
      revision: 4,
      jobs: [job("a", { origin: mix })],
      ids: ["b", "a"],
    });
    assert.deepEqual(groupsOf(retried), [
      ["Focus", "1 song left", []],
      ["Discover Mix 1", "1 song left", ["a"]],
    ]);
  });
});

describe("Downloading groups in Portuguese", () => {
  test("Songs, Favorites and the replacement runs are named in Portuguese; a playlist keeps its name", () => {
    const jobs = [
      job("own"),
      job("a", { origin: roadTrip }),
      job("b", { origin: roadTrip }),
      job("star", { origin: { kind: "favorites", id: "favorites", name: "Favorites" } }),
      job("up", { origin: { kind: "quality", id: "upgrade", name: "Quality upgrade" } }),
    ];
    assert.deepEqual(
      downloadingList(jobs, "pt-BR").groups.map((group) => [group.name, group.line]),
      [
        ["Músicas", "1 música restante"],
        ["Road Trip", "2 músicas restantes"],
        ["Favoritas", "1 música restante"],
        ["Melhoria de qualidade", "1 música restante"],
      ],
    );
  });
});

describe("The Downloading list's membership, apart from each song's progress (#1441)", () => {
  const ticking = (received: number) => [
    job("a", { origin: roadTrip, phase: "transferring", received, total: 100 }),
    job("b", { origin: roadTrip }),
    job("c", { origin: focus }),
  ];

  test("a progress tick leaves the list the same, its songs' lines aside", () => {
    // The ticking job comes fresh from the journal each time, its song too.
    const before = downloadingList(ticking(10));
    const after = downloadingList(ticking(42));
    assert.notEqual(before.downloading[0]?.line, after.downloading[0]?.line);
    assert.equal(sameDownloadingList(before, after), true);
    assert.equal(sameQueuedDownload(before.downloading[0]!, after.downloading[0]!), true);
  });

  test("a song joining, leaving, starting or turning to saving changes the list", () => {
    const before = downloadingList(ticking(10));
    const joined = downloadingList([...ticking(10), job("d", { origin: focus })]);
    const left = downloadingList(ticking(10).slice(0, 2));
    const started = downloadingList(
      ticking(10).map((each) =>
        each.id === "b" ? { ...each, phase: "preparing" as const } : each,
      ),
    );
    const saving = downloadingList(
      ticking(10).map((each) => (each.id === "a" ? { ...each, phase: "tagging" as const } : each)),
    );
    for (const after of [joined, left, started, saving]) {
      assert.equal(sameDownloadingList(before, after), false);
    }
    // Saving to the Library, a song can no longer be cancelled: its row changes.
    assert.equal(sameQueuedDownload(before.downloading[0]!, saving.downloading[0]!), false);
  });

  test("a group renamed, or moved, changes the list", () => {
    const before = downloadingList(ticking(10));
    const renamed = downloadingList(
      ticking(10).map((each) =>
        each.id === "c" ? { ...each, origin: { ...focus, name: "Deep Focus" } } : each,
      ),
    );
    const moved = downloadingList(moveQueuedJobs(ticking(10), ["c", "b"]));
    assert.equal(sameDownloadingList(before, renamed), false);
    assert.equal(sameDownloadingList(before, moved), false);
  });

  test("each song on its way has its own line, read without building the list", () => {
    const lines = queuedDownloadLines([
      ...ticking(42),
      job("lost", { phase: "failed", reason: "failed" }),
    ]);
    assert.deepEqual(
      [...lines],
      [
        ["a", "Downloading · 42%"],
        ["b", "Waiting to download"],
        ["c", "Waiting to download"],
      ],
    );
    assert.equal(queuedDownloadLines(ticking(42), catalogueOf("pt-BR")).get("a"), "Baixando · 42%");
  });
});

describe("A paused group (#1475)", () => {
  test("its header says Paused, and the others don't", () => {
    const jobs = [job("a", { origin: roadTrip }), job("b", { origin: focus })];
    const pause = pauseDownloadGroup(NO_DOWNLOAD_PAUSE, "playlist:7", jobs);
    const list = downloadingList(jobs, "en", pause);
    assert.deepEqual(
      list.groups.map((group) => [group.name, group.paused, group.line]),
      [
        ["Road Trip", true, "Paused · 1 song left"],
        ["Focus", false, "1 song left"],
      ],
    );
    assert.equal(
      downloadingList(jobs, "pt-BR", pause).groups[0]?.line,
      "Pausado · 1 música restante",
    );
    assert.equal(sameDownloadingList(list, downloadingList(jobs, "en")), false);
  });
});
