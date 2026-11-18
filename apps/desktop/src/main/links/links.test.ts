import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase, addTrack, closeTestDatabase, traceQueries } from "@wave/client/testing";
import { tracks } from "@wave/client/db/schema";
import { eq, sql } from "drizzle-orm";
import { createDesktopLinks } from "./links.ts";
import { createPlaylist } from "@wave/client/db/playlists";
import { catalogueOf } from "@wave/core";

test("plain pasted text leaves playback and the clipboard alone", async () => {
  const db = await openTestDatabase();
  try {
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async () => {
        throw new Error("No network for plain text");
      },
      start: async () => {
        throw new Error("Must not replace the queue");
      },
      writeClipboard: () => {
        throw new Error("Must not write clipboard");
      },
      changed: () => {},
    });
    assert.deepEqual(await links.open("Pink Moon", "en"), { kind: "ignored" });
  } finally {
    closeTestDatabase(db);
  }
});

test("Copy Link shares a playlist as the phone's unlisted YT Music copy", async () => {
  const db = await openTestDatabase();
  try {
    db.run(sql`CREATE TABLE desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    const made = createPlaylist(
      db,
      "Night Music",
      [
        {
          source: "stream",
          song: {
            videoId: "abcdefghijk",
            title: "Pink Moon",
            artists: ["Nick Drake"],
            album: null,
            durationMs: 124000,
            artworkUrl: null,
            explicit: false,
          },
        },
      ],
      Date.now(),
    );
    const clipboard: string[] = [];
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async (method, params) => {
        assert.equal(method, "createPlaylist");
        assert.deepEqual(params, {
          title: "Night Music",
          videoIds: ["abcdefghijk"],
          privacy: "UNLISTED",
        });
        return "PLsharedplaylist" as never;
      },
      start: async () => {},
      writeClipboard: (value) => {
        clipboard.push(value);
      },
      changed: () => {},
    });
    assert.equal((await links.copyPlaylist(made.playlistId, "en")).kind, "copied");
    assert.deepEqual(clipboard, ["https://music.youtube.com/playlist?list=PLsharedplaylist"]);
  } finally {
    closeTestDatabase(db);
  }
});

test("a playlist link previews its songs and Import makes a playlist using the phone's rules", async () => {
  const db = await openTestDatabase();
  try {
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async () =>
        ({
          title: "Night Music",
          songs: [{ videoId: "abcdefghijk", title: "Pink Moon", artists: ["Nick Drake"] }],
          continuation: null,
        }) as never,
      start: async () => {},
      writeClipboard: () => {},
      changed: () => {},
    });
    const opened = await links.open("https://music.youtube.com/playlist?list=PLabcdefghijk", "en");
    assert.equal(opened.kind, "playlist");
    if (opened.kind !== "playlist") return;
    assert.equal(opened.view.name, "Night Music");
    assert.equal(opened.view.canImport, true);
    const saved = await links.importPlaylist(opened.token, false);
    assert.equal(saved.name, "Night Music");
    assert.equal(saved.playlistId > 0, true);
    await assert.rejects(() => links.importPlaylist(opened.token, false));
  } finally {
    closeTestDatabase(db);
  }
});

test("Copy Link writes the phone's song.link URL for a known video", async () => {
  const db = await openTestDatabase();
  try {
    const clipboard: string[] = [];
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async () => {
        throw new Error("Known videos need no search");
      },
      start: async () => {},
      writeClipboard: (value) => {
        clipboard.push(value);
      },
      changed: () => {},
    });
    assert.equal((await links.copySong("abcdefghijk", "en")).kind, "copied");
    assert.deepEqual(clipboard, ["https://song.link/y/abcdefghijk"]);
  } finally {
    closeTestDatabase(db);
  }
});

test("a pasted YT Music song starts the Library's matching recording and opens Now Playing", async () => {
  const db = await openTestDatabase();
  try {
    const id = addTrack(db, { title: "Pink Moon", artist: "Nick Drake", durationMs: 124000 });
    const started: unknown[] = [];
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async () =>
        ({
          songs: [
            {
              videoId: "abcdefghijk",
              title: "Pink Moon",
              artists: ["Nick Drake"],
              durationMs: 124000,
            },
          ],
        }) as never,
      start: async (song) => {
        started.push(song);
      },
      writeClipboard: () => {},
      changed: () => {},
    });
    assert.deepEqual(
      await links.open("Listen! https://music.youtube.com/watch?v=abcdefghijk&si=ignored", "en"),
      { kind: "playing" },
    );
    assert.equal((started[0] as { id: number }).id, id);
  } finally {
    closeTestDatabase(db);
  }
});

test("a playlist link that can't be read shows why, and a link with YT Music off says to turn it on", async () => {
  const db = await openTestDatabase();
  try {
    const base = {
      db,
      online: () => true,
      start: async () => {
        throw new Error("Must not replace the queue");
      },
      writeClipboard: () => {},
      changed: () => {},
    };
    const links = createDesktopLinks({
      ...base,
      enabled: () => true,
      call: async () => {
        throw Object.assign(new Error("offline"), { code: "ERR_YT_OFFLINE" });
      },
      fetch: async () => {
        throw new Error("unreachable");
      },
    });
    for (const [link, line] of [
      ["https://music.youtube.com/playlist?list=PLabcdefghijk", catalogueOf("en").imports.offline],
      [
        "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
        catalogueOf("en").imports.spotifyUnreachable,
      ],
    ] as const) {
      const opened = await links.open(link, "en");
      assert.equal(opened.kind, "playlist");
      if (opened.kind !== "playlist") return;
      assert.equal(opened.view.line, line);
      assert.equal(opened.view.canImport, false);
      await assert.rejects(() => links.importPlaylist(opened.token, false));
    }
    const off = createDesktopLinks({
      ...base,
      enabled: () => false,
      call: async () => {
        throw new Error("Must ask YouTube nothing while YT Music is off");
      },
    });
    assert.equal(
      (await off.open("https://music.youtube.com/watch?v=abcdefghijk", "en")).kind,
      "notice",
    );
    assert.deepEqual(await off.open("Pink Moon", "en"), { kind: "ignored" });
  } finally {
    closeTestDatabase(db);
  }
});

test("a pasted link looks its video up in the Library once, however many songs there are", async () => {
  const db = await openTestDatabase();
  try {
    for (const title of ["Hazey Jane", "Northern Sky", "Place to Be", "Road"])
      addTrack(db, { title, artist: "Nick Drake" });
    const id = addTrack(db, { title: "Pink Moon", artist: "Nick Drake" });
    db.update(tracks).set({ videoId: "abcdefghijk" }).where(eq(tracks.id, id)).run();
    const started: unknown[] = [];
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async () => {
        throw new Error("A stored video needs no lookup");
      },
      start: async (song) => {
        started.push(song);
      },
      writeClipboard: () => {},
      changed: () => {},
    });
    const { result, queries } = traceQueries(db, () =>
      links.open("https://music.youtube.com/watch?v=abcdefghijk", "en"),
    );
    assert.deepEqual(await result, { kind: "playing" });
    assert.equal((started[0] as { id: number }).id, id);
    assert.equal(queries.filter((query) => query.sql.includes('"video_id" =')).length, 1);
  } finally {
    closeTestDatabase(db);
  }
});

test("Copy Link reads its one song, not the whole Library", async () => {
  const db = await openTestDatabase();
  try {
    db.run(sql`CREATE TABLE desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    for (const title of ["Hazey Jane", "Northern Sky", "Place to Be", "Road"])
      addTrack(db, { title, artist: "Nick Drake" });
    const id = addTrack(db, { title: "Pink Moon", artist: "Nick Drake" });
    db.update(tracks).set({ videoId: "abcdefghijk" }).where(eq(tracks.id, id)).run();
    const clipboard: string[] = [];
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async () => {
        throw new Error("A known video needs no search");
      },
      start: async () => {},
      writeClipboard: (value) => {
        clipboard.push(value);
      },
      changed: () => {},
    });
    const { result, queries } = traceQueries(db, () =>
      links.copySong({ scope: { kind: "songs" }, ids: [id] }, "en"),
    );
    assert.equal((await result).kind, "copied");
    assert.deepEqual(clipboard, ["https://song.link/y/abcdefghijk"]);
    // The song's row is the read with its title's sort key; the target's ids are another.
    const rows = queries.filter((query) => query.sql.includes('"title_sort"'));
    assert.deepEqual(
      rows.map((query) => query.rows),
      [1],
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("a pasted song whose radio names no album gets its album from a search for it", async () => {
  const db = await openTestDatabase();
  try {
    const song = {
      videoId: "abcdefghijk",
      title: "Pink Moon",
      artists: ["Nick Drake"],
      durationMs: 124000,
    };
    const calls: string[] = [];
    const remembered: { album?: string | null }[] = [];
    let changes = 0;
    const links = createDesktopLinks({
      db,
      enabled: () => true,
      online: () => true,
      call: async (method) => {
        calls.push(method);
        return {
          songs:
            method === "songRadio"
              ? [song]
              : [
                  { ...song, videoId: "zzzzzzzzzzz", title: "Road", album: "Other" },
                  { ...song, album: "Pink Moon", albumId: "MPREb_pinkmoon" },
                ],
        } as never;
      },
      start: async () => {},
      remember: (found) => remembered.push(found),
      writeClipboard: () => {},
      changed: () => changes++,
    });
    assert.deepEqual(await links.open("https://music.youtube.com/watch?v=abcdefghijk", "en"), {
      kind: "playing",
    });
    for (let waited = 0; remembered.length === 0 && waited < 50; waited++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(calls, ["songRadio", "search"]);
    assert.equal(remembered[0]?.album, "Pink Moon");
    assert.equal(changes, 1);
  } finally {
    closeTestDatabase(db);
  }
});
