import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogueOf,
  moveQueuedJobs,
  readStarDownloads,
  STAR_ASKED_SETTING,
  type MissingTrack,
  type YtAlbumSong,
} from "@wave/core";
import { createDownloads, type DownloadsDeps } from "./downloads.ts";
import type { KotlinDownloadMethod } from "../kotlin/protocol.ts";
import type { DownloadRow } from "../../shared/downloads.ts";

const song: YtAlbumSong = {
  videoId: "abcdefghijk",
  title: "Águas de Março",
  artists: ["Elis Regina", "Tom Jobim"],
  album: "Elis & Tom",
  durationMs: 212_000,
  artworkUrl: "https://lh3.googleusercontent.com/cover=w120-h120",
  explicit: false,
  albumId: "MPREb_album",
};

const missingTrack = (id: number, videoId: string | null = null): MissingTrack => ({
  id,
  title: `Song ${id}`,
  artist: "João Gilberto",
  artists: ["João Gilberto"],
  album: "Chega de Saudade",
  albumArtist: "João Gilberto",
  year: 1959,
  trackNumber: id,
  discNumber: null,
  genre: "Bossa Nova",
  durationMs: 120_000,
  videoId,
  releaseDate: null,
});

type Job = Record<string, unknown> & { id: string; phase: string };

/** The JVM's download journal, as far as the downloads service drives it. */
const fakeJournal = () => {
  let revision = 0;
  const jobs = new Map<string, Job>();
  const calls: { method: KotlinDownloadMethod; params: Record<string, unknown> }[] = [];
  let session: "off" | "disconnected" = "off";
  let pause: { until: number; level: number } | null = null;
  const call = async (method: KotlinDownloadMethod, params: object): Promise<unknown> => {
    calls.push({ method, params: params as Record<string, unknown> });
    const id = (params as { id?: string }).id ?? "";
    switch (method) {
      case "downloads.enqueueAll": {
        const { requests } = params as {
          requests: { song: { videoId: string }; source: string | null; origin: unknown }[];
        };
        for (const request of requests) {
          const id = request.song.videoId;
          jobs.set(id, {
            id,
            song: request.song,
            source: request.source,
            origin: request.origin,
            phase: "queued",
          });
        }
        revision += 1;
        return requests.map((request) => request.song.videoId);
      }
      case "downloads.changes":
        return { revision, jobs: [...jobs.values()], ids: [...jobs.keys()] };
      case "downloads.claim": {
        const job = jobs.get(id);
        return job?.phase === "preparing"
          ? { id, song: job["song"], generation: 3, token: "lease", decision: "prepare" }
          : null;
      }
      case "downloads.renew":
      case "downloads.submit":
        return true;
      case "downloads.cancel":
        jobs.set(id, { ...jobs.get(id)!, phase: "cancelled" });
        revision += 1;
        return null;
      case "downloads.move": {
        // As the journal's `moveQueued` (Core's `moveQueuedJobs`): the named jobs swap places.
        const order = (params as { ids: string[] }).ids;
        const moved = moveQueuedJobs([...jobs.values()] as (Job & { phase: "queued" })[], order);
        jobs.clear();
        for (const job of moved) jobs.set(job.id, job);
        revision += 1;
        return null;
      }
      case "downloads.youtubePause":
        return pause;
      case "downloads.pauseYoutube":
        pause = params as { until: number; level: number };
        return null;
      case "soulseek.session":
        return { status: session, username: null };
      case "soulseek.turnOn":
        session = "disconnected";
        return { status: session, username: "wave-user" };
      case "soulseek.turnOff":
        session = "off";
        return { status: session, username: null };
      default:
        return null;
    }
  };
  return {
    calls,
    jobs,
    call: call as DownloadsDeps["call"],
    /** The journal moves job [id] on, as its worker does. */
    set: (id: string, change: Record<string, unknown>) => {
      jobs.set(id, { ...jobs.get(id)!, ...change } as Job);
      revision += 1;
    },
    asked: (method: KotlinDownloadMethod) =>
      calls.filter((call) => call.method === method).map((call) => call.params),
  };
};

const setup = (change: Partial<DownloadsDeps> = {}) => {
  const journal = fakeJournal();
  const answered: unknown[] = [];
  let missing: readonly MissingTrack[] = [missingTrack(41, "zyxwvutsrqp"), missingTrack(42)];
  const downloads = createDownloads({
    call: journal.call,
    answer: async (claim) => {
      answered.push(claim);
      return { source: "youtube" };
    },
    missingSongs: (ids) =>
      ids === undefined ? missing : missing.filter((track) => ids.includes(track.id)),
    list: (list) =>
      list.kind === "album" && list.id === 7
        ? { ids: [41, 42, 43], origin: { kind: "album", id: "7", name: "Chega de Saudade" } }
        : null,
    ytSong: (videoId) => (videoId === song.videoId ? song : undefined),
    ytMusicOn: () => true,
    catalogue: catalogueOf("en", "desktop"),
    now: () => 1_000,
    pollMs: 60_000,
    ...change,
  });
  return {
    journal,
    answered,
    downloads,
    stillMissing: (tracks: readonly MissingTrack[]) => {
      missing = tracks;
    },
  };
};

test("a YT Music song asked for is queued from YouTube Music and listed as queued", async () => {
  const { journal, downloads } = setup();
  await downloads.yt([song.videoId]);
  const [asked] = journal.asked("downloads.enqueueAll") as {
    requests: { recording: { title: string } }[];
  }[];
  const [{ recording, ...request }] = asked!.requests as [{ recording: { title: string } }];
  assert.deepEqual(request, { song, equivalentId: null, source: "youtube", origin: null });
  assert.equal(typeof recording.title, "string");
  const rows = downloads.rows(0, 50);
  assert.equal(downloads.view().rows, 1);
  assert.deepEqual(rows.items[1], {
    kind: "waiting",
    key: `waiting:${song.videoId}`,
    id: song.videoId,
    title: "Águas de Março",
    artist: "Elis Regina & Tom Jobim",
    artworkUrl: song.artworkUrl,
    line: "Waiting to download",
    cancel: [song.videoId],
    groupKey: "songs",
    index: 0,
    count: 1,
  });
  downloads.dispose();
});

test("a decision the journal offers is claimed, answered and submitted with its lease", async () => {
  const { journal, answered, downloads } = setup();
  await downloads.yt([song.videoId]);
  journal.set(song.videoId, { phase: "preparing" });
  await downloads.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(answered.length, 1);
  assert.deepEqual(journal.asked("downloads.submit"), [
    {
      id: song.videoId,
      generation: 3,
      token: "lease",
      decision: "prepare",
      payload: { source: "youtube" },
    },
  ]);
  downloads.dispose();
});

type Asked = { song: { videoId: string; title: string }; source: string | null; origin: unknown };
/** The songs among the page's [rows], without their headers. */
const songsOf = (rows: readonly DownloadRow[]) => rows.flatMap((row) => ("id" in row ? [row] : []));

const requests = (journal: ReturnType<typeof fakeJournal>): Asked[] =>
  journal.asked("downloads.enqueueAll").flatMap((params) => params["requests"] as Asked[]);

test("a missing song clicked is downloaded into its Track, from its video when it has one", async () => {
  const { journal, downloads } = setup();
  await downloads.missing([41, 42]);
  assert.deepEqual(
    requests(journal).map(({ song, source, origin }) => ({ id: song.videoId, source, origin })),
    [
      { id: "missing:41", source: "youtube", origin: null },
      { id: "missing:42", source: "youtube", origin: null },
    ],
  );
  assert.deepEqual(
    songsOf(downloads.rows(0, 50).items).map((row) => [row.title, row.artist]),
    [
      ["Song 41", "João Gilberto"],
      ["Song 42", "João Gilberto"],
    ],
  );
  downloads.dispose();
});

test("an album's Download Missing Songs asks for its missing songs under the album", async () => {
  const { journal, downloads } = setup();
  const album = { kind: "album", id: 7 } as const;
  assert.deepEqual(downloads.listView(album)?.actions, ["downloadAll"]);
  assert.equal(downloads.listView(album)?.count, 2);
  await downloads.missingAction("downloadAll", album);
  const origin = { kind: "album", id: "7", name: "Chega de Saudade" };
  assert.deepEqual(
    requests(journal).map(({ song, origin }) => [song.videoId, origin]),
    [
      ["missing:41", origin],
      ["missing:42", origin],
    ],
  );
  assert.deepEqual(downloads.listView(album)?.actions, ["cancel"]);
  assert.equal(downloads.listView({ kind: "album", id: 8 }), null);
  downloads.dispose();
});

test("Download All asks for every missing song not on its way, and Cancel stops them", async () => {
  const { journal, downloads } = setup();
  await downloads.missing([41]);
  await downloads.missingAction("downloadAll");
  assert.deepEqual(
    requests(journal).map(({ song }) => song.videoId),
    ["missing:41", "missing:42"],
  );
  await downloads.missingAction("cancel");
  assert.deepEqual(journal.asked("downloads.cancel"), [{ id: "missing:41" }, { id: "missing:42" }]);
  assert.equal(downloads.rows(0, 50).total, 0);
  downloads.dispose();
});

test("with Download in best quality on, a song comes from Soulseek unless it has its video", async () => {
  const { journal, downloads } = setup();
  assert.equal(await downloads.bestQuality(), false);
  assert.equal(await downloads.setBestQuality(true), true);
  assert.equal(await downloads.bestQuality(), true);
  await downloads.missing([41, 42]);
  await downloads.yt([song.videoId]);
  assert.deepEqual(
    requests(journal).map(({ song, source }) => [song.videoId, source]),
    [
      ["missing:41", "youtube"],
      ["missing:42", "soulseek"],
      [song.videoId, "soulseek"],
    ],
  );
  assert.equal(await downloads.setBestQuality(false), false);
  downloads.dispose();
});

test("offline the journal stops, and it starts again once back online", async () => {
  const { journal, downloads } = setup();
  await downloads.start(true);
  await downloads.setOnline(false);
  await downloads.setOnline(false);
  assert.equal(downloads.view().online, false);
  await downloads.yt([song.videoId]);
  await downloads.setOnline(true);
  assert.deepEqual(
    journal.calls
      .map(({ method }) => method)
      .filter((method) => method === "downloads.start" || method === "downloads.stop"),
    ["downloads.start", "downloads.stop", "downloads.start"],
  );
  assert.equal(downloads.view().online, true);
  downloads.dispose();
});

test("the run's progress counts finished songs and the part of each file that arrived", async () => {
  const { journal, downloads } = setup();
  assert.equal(downloads.view().progress, null);
  await downloads.missing([41, 42]);
  journal.set("missing:41", {
    phase: "completed",
    acknowledged: true,
    saved: { path: "/m/41.m4a" },
  });
  journal.set("missing:42", { phase: "transferring", received: 50, total: 100 });
  await downloads.refresh();
  const view = downloads.view();
  assert.equal(view.progress, 0.75);
  assert.deepEqual(view.run, { done: 1, failed: 0, left: 1, total: 2 });
  assert.deepEqual(
    songsOf(downloads.rows(0, 50).items).map((row) => row.id),
    ["missing:42"],
  );
  downloads.dispose();
});

test("Retry asks again for a failed song, and Clear Failed takes the failures off the list", async () => {
  const { journal, downloads, stillMissing } = setup();
  await downloads.yt([song.videoId]);
  await downloads.missing([41, 42]);
  for (const id of [song.videoId, "missing:41", "missing:42"])
    journal.set(id, { phase: "failed", reason: "notFound" });
  await downloads.refresh();
  assert.equal(downloads.view().failed, 3);
  // Song 41 was filled in meanwhile: there is nothing left to retry for it.
  stillMissing([missingTrack(42)]);
  await downloads.retry();
  assert.deepEqual(
    requests(journal)
      .slice(3)
      .map(({ song }) => song.videoId),
    [song.videoId, "missing:42"],
  );
  journal.set(song.videoId, { phase: "failed", reason: "notFound" });
  journal.set("missing:42", { phase: "failed", reason: "notFound" });
  await downloads.refresh();
  await downloads.clearFailed();
  assert.equal(downloads.rows(0, 50).total, 0);
  assert.equal(downloads.view().failed, 0);
  downloads.dispose();
});

test("missing-song progress is readable by id and a notice records a download start", async () => {
  const { downloads, journal } = setup();
  try {
    await downloads.missing([41]);
    assert.deepEqual(downloads.status(41), { kind: "queued" });
    assert.equal(downloads.view().notice?.count, 1);
    journal.set("missing:41", { phase: "transferring", progress: 0.4 });
    await downloads.refresh();
    assert.equal(downloads.status(41)?.kind, "downloading");
  } finally {
    downloads.dispose();
  }
});

test("a download Add to Playlist asked for says nothing of its own: the playlist's toast does", async () => {
  const { downloads, journal } = setup();
  try {
    await downloads.yt([song.videoId], "playlist");
    await downloads.missing([41], "playlist");
    assert.deepEqual(
      requests(journal).map(({ song }) => song.videoId),
      [song.videoId, "missing:41"],
    );
    assert.equal(downloads.view().notice, null);
  } finally {
    downloads.dispose();
  }
});

/** The star's state the service keeps on this computer: a key-value store. */
const starSetup = (starred: number[]) => {
  const kept = new Map<string, string>();
  const stars = new Set(starred);
  const done = setup({
    favorites: () => stars,
    store: {
      read: (key) => kept.get(key) ?? null,
      write: (key, value) => {
        if (value === null) kept.delete(key);
        else kept.set(key, value);
      },
    },
  });
  return { ...done, stars, kept };
};

test("a star means downloaded: each starred missing song is asked for under Favorites, once", async () => {
  const { journal, downloads } = starSetup([42]);
  await downloads.syncStars();
  assert.deepEqual(
    requests(journal).map(({ song, origin }) => [song.videoId, origin]),
    [["missing:42", { kind: "favorites", id: "favorites", name: "Favorites" }]],
  );
  // A star's download says nothing of its own: the star is the toast.
  assert.equal(downloads.view().notice, null);
  // Seen once, a star doesn't ask again, even after its download was cancelled.
  await downloads.cancel(["missing:42"]);
  await downloads.syncStars();
  assert.equal(requests(journal).length, 1);
  downloads.dispose();
});

test("a new star on a missing song asks for it; unstarring it before the file arrives cancels", async () => {
  const { journal, downloads, stars } = starSetup([]);
  await downloads.syncStars();
  assert.equal(requests(journal).length, 0);
  stars.add(41);
  await downloads.syncStars();
  assert.deepEqual(
    requests(journal).map(({ song }) => song.videoId),
    ["missing:41"],
  );
  stars.delete(41);
  await downloads.syncStars();
  assert.deepEqual(journal.asked("downloads.cancel"), [{ id: "missing:41" }]);
  downloads.dispose();
});

test("unstarring keeps a download the owner asked for, and a star retries a failed one", async () => {
  const { journal, downloads, stars } = starSetup([]);
  await downloads.missing([41]);
  stars.add(41);
  await downloads.syncStars();
  // Already on its way: the star leaves it be, and taking the star back doesn't cancel it.
  assert.equal(requests(journal).length, 1);
  stars.delete(41);
  await downloads.syncStars();
  assert.deepEqual(journal.asked("downloads.cancel"), []);
  journal.set("missing:41", { phase: "failed", reason: "notFound" });
  await downloads.refresh();
  stars.add(41);
  await downloads.syncStars();
  assert.deepEqual(
    requests(journal).map(({ song, origin }) => [song.videoId, origin]),
    [
      ["missing:41", null],
      ["missing:41", null],
    ],
  );
  downloads.dispose();
});

test("an owner's Download takes a star's download from the star", async () => {
  const { journal, downloads, stars } = starSetup([42]);
  await downloads.syncStars();
  await downloads.missingAction("downloadAll");
  stars.delete(42);
  await downloads.syncStars();
  assert.deepEqual(journal.asked("downloads.cancel"), []);
  downloads.dispose();
});

test("a star on a song being listened to asks for it; taking the star back before the file arrives cancels", async () => {
  const { journal, downloads } = starSetup([]);
  await downloads.yt([song.videoId], "star");
  assert.deepEqual(
    requests(journal).map((request) => request.song.videoId),
    [song.videoId],
  );
  await downloads.unstarred([song.videoId]);
  assert.deepEqual(journal.asked("downloads.cancel"), [{ id: song.videoId }]);
  // Taken back once: a second unstar has nothing left to cancel.
  await downloads.unstarred([song.videoId]);
  assert.equal(journal.asked("downloads.cancel").length, 1);
  downloads.dispose();
});

test("a star taken back keeps a download the owner then asked for themselves", async () => {
  const { journal, downloads } = starSetup([]);
  await downloads.yt([song.videoId], "star");
  await downloads.yt([song.videoId]);
  await downloads.unstarred([song.videoId]);
  assert.deepEqual(journal.asked("downloads.cancel"), []);
  downloads.dispose();
});

test("cancelling an album download clears the cancelled songs' star claims", async () => {
  const { journal, downloads, kept } = starSetup([42]);
  const album = {
    songs: [song],
    inLibrary: () => false,
    origin: { kind: "album", id: "MPREb_album", name: "Elis & Tom" } as const,
  };
  try {
    const claims = () => readStarDownloads(kept.get(STAR_ASKED_SETTING) ?? null);
    await downloads.syncStars();
    await downloads.yt([song.videoId], "star");
    assert.deepEqual(claims(), new Set(["missing:42", song.videoId]));
    await downloads.ytListAction("cancel", album);
    assert.deepEqual(journal.asked("downloads.cancel"), [{ id: song.videoId }]);
    assert.deepEqual(claims(), new Set(["missing:42"]));
  } finally {
    downloads.dispose();
  }
});

test("a missing song starred while listened to is cancelled when its star comes off anywhere", async () => {
  const { journal, downloads, stars } = starSetup([]);
  stars.add(41);
  await downloads.missing([41], "star");
  await downloads.syncStars();
  assert.equal(requests(journal).length, 1);
  stars.delete(41);
  await downloads.syncStars();
  assert.deepEqual(journal.asked("downloads.cancel"), [{ id: "missing:41" }]);
  downloads.dispose();
});

test("what the stars asked is kept, so a restart neither asks again nor forgets to cancel", async () => {
  const first = starSetup([42]);
  await first.downloads.syncStars();
  first.downloads.dispose();
  const kept = [...first.kept];
  const { journal, downloads, stars, kept: store } = starSetup([42]);
  for (const [key, value] of kept) store.set(key, value);
  // The journal still holds the job the first run asked for.
  for (const [id, job] of first.journal.jobs) journal.jobs.set(id, job);
  await downloads.refresh();
  await downloads.syncStars();
  assert.equal(requests(journal).length, 0);
  stars.delete(42);
  await downloads.syncStars();
  assert.deepEqual(journal.asked("downloads.cancel"), [{ id: "missing:42" }]);
  downloads.dispose();
});

/** What a page of rows shows, a line each: a header as `# name · line`, a song as its title. */
const shown = (rows: readonly DownloadRow[]) =>
  rows.map((row) =>
    row.kind === "header" || row.kind === "startedHeader"
      ? `# ${row.name} · ${row.line}`
      : "id" in row
        ? `${row.kind} ${row.id}`
        : `## ${row.line}`,
  );

/** An album, two single songs and a YT Music song waiting, asked for in that order. */
const waitingGroups = async () => {
  const context = setup({
    missingSongs: (ids) =>
      [41, 42, 43, 44, 45]
        .filter((id) => ids === undefined || ids.includes(id))
        .map((id) => missingTrack(id)),
  });
  await context.downloads.missingAction("downloadAll", { kind: "album", id: 7 });
  await context.downloads.missing([44, 45]);
  return context;
};

test("waiting songs sit under a header for where they were asked from, single songs under Songs", async () => {
  const { journal, downloads } = await waitingGroups();
  journal.set("missing:41", { phase: "transferring", received: 10, total: 100 });
  await downloads.refresh();
  const page = downloads.rows(0, 50);
  assert.deepEqual(shown(page.items), [
    "downloading missing:41",
    "# Chega de Saudade · 0 of 3 · 3 left",
    "waiting missing:42",
    "waiting missing:43",
    "# Songs · 0 of 2 · 2 left",
    "waiting missing:44",
    "waiting missing:45",
  ]);
  assert.equal(page.total, 7);
  assert.deepEqual(shown(downloads.rows(5, 1).items), ["waiting missing:44"]);
  const view = downloads.view();
  assert.equal(view.rows, 5);
  assert.equal(view.summary, "1 downloading · 4 waiting");
  downloads.dispose();
});

test("a group dragged onto another moves its songs ahead in the journal's order", async () => {
  const { journal, downloads } = await waitingGroups();
  await downloads.move({ kind: "group", from: "songs", to: "album:7" });
  assert.deepEqual(journal.asked("downloads.move"), [
    { ids: ["missing:44", "missing:45", "missing:41", "missing:42", "missing:43"] },
  ]);
  assert.deepEqual(shown(downloads.rows(0, 50).items), [
    "# Songs · 0 of 2 · 2 left",
    "waiting missing:44",
    "waiting missing:45",
    "# Chega de Saudade · 0 of 3 · 3 left",
    "waiting missing:41",
    "waiting missing:42",
    "waiting missing:43",
  ]);
  // Move Down puts it back; a group at the end has nowhere further to go.
  await downloads.move({ kind: "group", from: "songs", step: 1 });
  await downloads.move({ kind: "group", from: "songs", step: 1 });
  assert.equal(journal.asked("downloads.move").length, 2);
  assert.deepEqual(
    songsOf(downloads.rows(0, 50).items).map((row) => row.id),
    ["missing:41", "missing:42", "missing:43", "missing:44", "missing:45"],
  );
  downloads.dispose();
});

test("a song moves among its group's waiting songs only", async () => {
  const { journal, downloads } = await waitingGroups();
  await downloads.move({ kind: "song", from: "missing:43", to: "missing:41" });
  assert.deepEqual(journal.asked("downloads.move"), [
    { ids: ["missing:43", "missing:41", "missing:42"] },
  ]);
  await downloads.move({ kind: "song", from: "missing:43", step: 1 });
  assert.deepEqual(
    songsOf(downloads.rows(0, 50).items).map((row) => row.id),
    ["missing:41", "missing:43", "missing:42", "missing:44", "missing:45"],
  );
  // Another group's song is no place for it, nor is a song that started meanwhile.
  await downloads.move({ kind: "song", from: "missing:43", to: "missing:44" });
  journal.set("missing:41", { phase: "transferring", received: 1, total: 100 });
  await downloads.refresh();
  await downloads.move({ kind: "song", from: "missing:43", to: "missing:41" });
  await downloads.move({ kind: "song", from: "missing:42", step: 1 });
  assert.equal(journal.asked("downloads.move").length, 2);
  downloads.dispose();
});

test("the failed section is folded until shown, then groups the songs by why they failed", async () => {
  const { journal, downloads } = await waitingGroups();
  journal.set("missing:41", { phase: "failed", reason: "notFound" });
  journal.set("missing:42", { phase: "failed", reason: "noSource" });
  journal.set("missing:44", { phase: "failed", reason: "notFound", cause: "IOException: reset" });
  await downloads.refresh();
  assert.deepEqual(shown(downloads.rows(0, 50).items).slice(-1), ["## 3 songs failed"]);
  const open = downloads.rows(0, 50, true).items;
  assert.deepEqual(shown(open).slice(-6), [
    "## 3 songs failed",
    "## Not found online · 2",
    "failedSong missing:41",
    "failedSong missing:44",
    "## Turn on YT Music or Download in best quality in Settings · 1",
    "failedSong missing:42",
  ]);
  const last = open.at(-3);
  assert.equal(last?.kind === "failedSong" && last.detail, "reset");
  assert.deepEqual(last?.kind === "failedSong" && last.cancel, ["missing:44"]);

  // A reason's Retry asks again for its songs alone, and its Remove takes them off the list.
  await downloads.failedReason("Not found online", "retry");
  assert.deepEqual(
    requests(journal)
      .slice(5)
      .map(({ song }) => song.videoId),
    ["missing:41", "missing:44"],
  );
  await downloads.failedReason(
    "Turn on YT Music or Download in best quality in Settings",
    "remove",
  );
  assert.deepEqual(journal.asked("downloads.cancel"), [{ id: "missing:42" }]);
  assert.equal(downloads.view().failed, 0);
  assert.equal(
    downloads.rows(0, 50, true).items.some((row) => row.kind === "failedHeader"),
    false,
  );
  downloads.dispose();
});

test("the run panel counts the run, says Paused while nothing moves and gives the time left", async () => {
  let at = 1_000;
  const { journal, downloads } = setup({
    now: () => at,
    missingSongs: (ids) =>
      [41, 42, 43, 44, 45, 46]
        .filter((id) => ids === undefined || ids.includes(id))
        .map((id) => missingTrack(id)),
  });
  assert.equal(downloads.view().panel, null);
  assert.equal(downloads.view().summary, null);
  await downloads.missing([41, 42, 43, 44, 45, 46]);
  assert.deepEqual(downloads.view().panel, {
    count: "0 of 6",
    fraction: 0,
    line: "6 left · Paused",
  });
  // Three songs done over two minutes: the three left should take about two more.
  journal.set("missing:46", { phase: "transferring", received: 1, total: 100 });
  for (const id of [41, 42, 43]) {
    at += 40_000;
    journal.set(`missing:${id}`, {
      phase: "completed",
      acknowledged: true,
      saved: { path: `/m/${id}.m4a` },
    });
    await downloads.refresh();
  }
  const view = downloads.view();
  assert.deepEqual(view.panel, {
    count: "3 of 6",
    fraction: 0.5,
    line: "3 left · About 2 min left",
  });
  assert.equal(view.summary, "1 downloading · 2 waiting");
  assert.equal(view.pauseNotice, null);
  downloads.dispose();
});

test("a burst of YouTube refusals pauses YouTube's songs, and the page says for how long", async () => {
  let at = 1_000_000;
  const ids = [41, 42, 43, 44, 45, 46];
  const { journal, downloads } = setup({
    now: () => at,
    missingSongs: (asked) =>
      ids.filter((id) => asked === undefined || asked.includes(id)).map((id) => missingTrack(id)),
  });
  await downloads.start(true);
  await downloads.missing(ids);
  // A download worked, then YouTube refused five different songs within a minute.
  at += 1_000;
  journal.set("missing:46", { phase: "transferring", servedAt: at });
  await downloads.refresh();
  for (const id of [41, 42, 43, 44, 45]) {
    at += 1_000;
    journal.set(`missing:${id}`, { phase: "prepared", refusedAt: at });
  }
  await downloads.refresh();
  assert.deepEqual(journal.asked("downloads.pauseYoutube"), [{ until: at + 120_000, level: 1 }]);
  const view = downloads.view();
  assert.equal(view.pauseNotice, "Paused: YouTube is limiting downloads. Next try in 2 min");
  // The pause's own line says when it tries again, so the panel's adds nothing.
  assert.equal(view.panel?.line, "6 left");
  at += 121_000;
  assert.equal(downloads.view().pauseNotice, null);
  downloads.dispose();
});

test("a restarted journal's pause is read back, so the page still says it", async () => {
  const at = 1_000_000;
  const { journal, downloads } = setup({ now: () => at });
  await journal.call("downloads.pauseYoutube", { until: at + 300_000, level: 2 });
  await downloads.start(true);
  assert.equal(
    downloads.view().pauseNotice,
    "Paused: YouTube is limiting downloads. Next try in 5 min",
  );
  downloads.dispose();
});

test("a YT Music album's Download queues the songs the Library lacks, in album order, under the album", async () => {
  const { journal, downloads } = setup();
  try {
    const track = (n: number, videoId: string) => ({ ...song, videoId, title: `Track ${n}` });
    const songs = [track(1, "aaaaaaaaaa1"), track(2, "aaaaaaaaaa2"), track(3, "aaaaaaaaaa3")];
    let had = new Set(["aaaaaaaaaa2"]);
    const origin = { kind: "album", id: "MPREb_album", name: "Elis & Tom" } as const;
    const album = {
      songs,
      inLibrary: (each: { videoId: string }) => had.has(each.videoId),
      origin,
    };
    assert.deepEqual(downloads.ytListView(album), {
      button: { action: "download", label: "Download" },
      line: null,
    });
    await downloads.ytListAction("download", album);
    assert.deepEqual(
      requests(journal).map(({ song, origin }) => [song.videoId, origin]),
      [
        ["aaaaaaaaaa1", origin],
        ["aaaaaaaaaa3", origin],
      ],
    );
    // While they're on their way: Cancel, and the head counts the saved songs.
    assert.deepEqual(downloads.ytListView(album), {
      button: { action: "cancel", label: "Cancel" },
      line: "Downloading · 0 of 2",
    });
    journal.set("aaaaaaaaaa1", {
      phase: "completed",
      acknowledged: true,
      saved: { path: "/m/01 Track 1.m4a" },
    });
    // Saved, it's the Library's.
    had = new Set([...had, "aaaaaaaaaa1"]);
    await downloads.refresh();
    assert.equal(downloads.ytListView(album).line, "Downloading · 1 of 2");
    // One fails: Retry Failed asks for it again, under the album.
    journal.set("aaaaaaaaaa3", { phase: "failed", reason: "notFound" });
    await downloads.refresh();
    assert.deepEqual(downloads.ytListView(album).button, {
      action: "retryFailed",
      label: "Retry Failed",
    });
    await downloads.ytListAction("retryFailed", album);
    assert.deepEqual(
      requests(journal)
        .slice(2)
        .map(({ song, origin }) => [song.videoId, origin]),
      [["aaaaaaaaaa3", origin]],
    );
    await downloads.ytListAction("cancel", album);
    assert.deepEqual(journal.asked("downloads.cancel"), [{ id: "aaaaaaaaaa3" }]);
    // The Library has every song: Downloaded.
    had = new Set(songs.map((each) => each.videoId));
    assert.deepEqual(downloads.ytListView(album).button, {
      action: "downloaded",
      label: "Downloaded",
    });
  } finally {
    downloads.dispose();
  }
});
