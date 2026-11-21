import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogueOf, type MissingTrack, type YtAlbumSong } from "@wave/core";
import { createDownloads, type DownloadsDeps } from "./downloads.ts";
import type { KotlinDownloadMethod } from "../kotlin/protocol.ts";

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
  assert.equal(rows.total, 1);
  assert.deepEqual(rows.items[0], {
    id: song.videoId,
    title: "Águas de Março",
    artist: "Elis Regina & Tom Jobim",
    album: "Elis & Tom",
    artworkUrl: song.artworkUrl,
    status: { kind: "queued" },
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
    downloads.rows(0, 50).items.map((row) => [row.title, row.artist]),
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
    downloads.rows(0, 50).items.map((row) => row.id),
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
