import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PLAYLIST_NAME_MAX,
  checkPlaylistName,
  confirmImportReplace,
  importNameClash,
  isM3uFileName,
  keepBothName,
  libraryPathIndex,
  parseM3u,
  planM3uImport,
  resolveM3uPath,
  summarizeM3uImport,
} from "./index.ts";

describe("isM3uFileName", () => {
  test(".m3u and .m3u8 files are playlists, in any case", () => {
    assert.equal(isM3uFileName("Drive.m3u"), true);
    assert.equal(isM3uFileName("Drive.M3U8"), true);
    assert.equal(isM3uFileName("Drive.pls"), false);
    assert.equal(isM3uFileName("Drive.m3u.txt"), false);
  });
});

describe("parseM3u", () => {
  test("a plain list gives one entry per line, in file order", () => {
    assert.deepEqual(parseM3u("Rock/Airbag.mp3\n/storage/emulated/0/Music/Bloom.flac\n"), [
      { location: "Rock/Airbag.mp3", title: null },
      { location: "/storage/emulated/0/Music/Bloom.flac", title: null },
    ]);
  });

  test("#EXTINF gives the next entry its title; #EXTM3U and comments are ignored", () => {
    const text = [
      "#EXTM3U",
      "#PLAYLIST:Drive",
      "#EXTINF:240,Radiohead - Airbag",
      "Rock/Airbag.mp3",
      "# a comment",
      "Rock/Bloom.mp3",
      '#EXTINF:-1 tvg-name="a, b",Massive Attack - Teardrop',
      "Trip/Teardrop.mp3",
    ].join("\r\n");
    assert.deepEqual(parseM3u(text), [
      { location: "Rock/Airbag.mp3", title: "Radiohead - Airbag" },
      { location: "Rock/Bloom.mp3", title: null },
      { location: "Trip/Teardrop.mp3", title: "Massive Attack - Teardrop" },
    ]);
  });

  test("a byte-order mark, blank lines and stray spaces don't make entries", () => {
    assert.deepEqual(parseM3u(String.fromCodePoint(0xfeff) + "#EXTM3U\n\n  Airbag.mp3  \r\n\n"), [
      { location: "Airbag.mp3", title: null },
    ]);
  });

  test("an #EXTINF without a title leaves the entry untitled", () => {
    assert.deepEqual(parseM3u("#EXTINF:240,\nAirbag.mp3"), [
      { location: "Airbag.mp3", title: null },
    ]);
  });
});

describe("resolveM3uPath", () => {
  const playlist = "/storage/emulated/0/Playlists/Drive.m3u";

  test("an absolute path stands as it is", () => {
    assert.equal(
      resolveM3uPath("/storage/emulated/0/Music/Airbag.mp3", playlist),
      "/storage/emulated/0/Music/Airbag.mp3",
    );
  });

  test("a relative path starts from the playlist file's folder", () => {
    assert.equal(
      resolveM3uPath("Rock/Airbag.mp3", playlist),
      "/storage/emulated/0/Playlists/Rock/Airbag.mp3",
    );
    assert.equal(
      resolveM3uPath("../Music/Rock/./Airbag.mp3", playlist),
      "/storage/emulated/0/Music/Rock/Airbag.mp3",
    );
  });

  test("Windows-style separators are read as folders", () => {
    assert.equal(
      resolveM3uPath("..\\Music\\Airbag.mp3", playlist),
      "/storage/emulated/0/Music/Airbag.mp3",
    );
  });

  test("a file URL is a path, with its escapes undone", () => {
    assert.equal(
      resolveM3uPath("file:///storage/emulated/0/Music/Caf%C3%A9%20Bleu.mp3", playlist),
      "/storage/emulated/0/Music/Café Bleu.mp3",
    );
  });

  test("a relative path can't resolve when the playlist file's folder is unknown", () => {
    assert.equal(resolveM3uPath("Rock/Airbag.mp3", null), null);
    assert.equal(resolveM3uPath("/Music/Airbag.mp3", null), "/Music/Airbag.mp3");
  });

  test("web addresses and other drives aren't files on this phone", () => {
    assert.equal(resolveM3uPath("https://example.com/stream.mp3", playlist), null);
    assert.equal(resolveM3uPath("C:\\Music\\Airbag.mp3", playlist), null);
  });
});

describe("importNameClash", () => {
  const playlists = [
    { id: 1, name: "Road Trip" },
    { id: 2, name: "Café del Mar" },
  ];

  test("finds the playlist that already has the name, ignoring case, accents and spacing", () => {
    assert.equal(importNameClash("cafe  DEL mar", playlists)?.id, 2);
    assert.equal(importNameClash("Road Trip", playlists)?.id, 1);
    assert.equal(importNameClash("Road Trip 2", playlists), undefined);
  });

  test("keeping both numbers the new one: the first number no playlist has", () => {
    assert.equal(keepBothName("Road Trip", ["Road Trip"]), "Road Trip 2");
    assert.equal(keepBothName("Road Trip", ["Road Trip", "road trip 2"]), "Road Trip 3");
  });

  test("a numbered name still fits the length limit", () => {
    const name = "x".repeat(PLAYLIST_NAME_MAX);
    const both = keepBothName(name, [name]);
    assert.equal(both, `${"x".repeat(PLAYLIST_NAME_MAX - 2)} 2`);
    assert.equal(checkPlaylistName(both, [name]).ok, true);
  });

  test("the clash asks whether to replace the playlist or keep both", () => {
    assert.deepEqual(confirmImportReplace("Road Trip"), {
      title: "Replace Road Trip?",
      message:
        "You already have a playlist called Road Trip. Replace its songs with the imported ones, or keep both playlists.",
      action: { label: "Replace", destructive: true },
      dismissLabel: "Keep Both",
    });
  });
});

/** A playlist file saved in the Music folder. */
const file = (name: string, text: string) => ({
  name,
  path: `/storage/emulated/0/Music/${name}`,
  text,
});

describe("planM3uImport", () => {
  const library = libraryPathIndex([
    { id: 1, path: "/storage/emulated/0/Music/Rock/Airbag.mp3" },
    { id: 2, path: "/storage/emulated/0/Music/Rock/Bloom.flac" },
    { id: 3, path: "/storage/emulated/0/Music/Trip/Teardrop.mp3" },
  ]);

  test("the playlist is named after the file and holds its songs in file order", () => {
    const text = [
      "#EXTM3U",
      "#EXTINF:290,Massive Attack - Teardrop",
      "Trip/Teardrop.mp3",
      "/storage/emulated/0/Music/Rock/Airbag.mp3",
      "Rock\\Bloom.flac",
    ].join("\n");
    assert.deepEqual(planM3uImport(file("Night Drive.m3u8", text), library), {
      name: "Night Drive",
      trackIds: [3, 1, 2],
      missing: [],
    });
  });

  test("entries that aren't in the library are skipped and listed by title, else file name", () => {
    const text = [
      "Rock/Airbag.mp3",
      "#EXTINF:200,Portishead - Roads",
      "Trip/Roads.mp3",
      "https://radio.example/live",
      "Rock/Creep.mp3",
    ].join("\n");
    assert.deepEqual(planM3uImport(file("Mix.m3u", text), library), {
      name: "Mix",
      trackIds: [1],
      missing: ["Portishead - Roads", "live", "Creep.mp3"],
    });
  });

  test("a song listed twice goes in once, where it first appears", () => {
    const text = "Rock/Bloom.flac\nRock/Airbag.mp3\nRock/Bloom.flac";
    assert.deepEqual(planM3uImport(file("Loop.m3u", text), library).trackIds, [2, 1]);
  });

  test("the name is one a playlist can have: tidied, cut to the limit, never empty", () => {
    assert.equal(planM3uImport(file("  Road__Trip   2.M3U", ""), library).name, "Road__Trip 2");
    const long = planM3uImport(file(`${"x".repeat(120)}.m3u`, ""), library).name;
    assert.equal(checkPlaylistName(long, []).ok, true);
    assert.equal(long, "x".repeat(PLAYLIST_NAME_MAX));
    assert.equal(planM3uImport(file(".m3u", ""), library).name, "Imported Playlist");
  });

  test("a path that differs only in case still finds its song", () => {
    const text = "rock/AIRBAG.MP3";
    assert.deepEqual(planM3uImport(file("Case.m3u", text), library).trackIds, [1]);
  });
});

describe("summarizeM3uImport", () => {
  test("one playlist imported whole is named in the title", () => {
    assert.deepEqual(
      summarizeM3uImport([
        { kind: "imported", name: "Road Trip", songs: 12, missing: [], replaced: false },
      ]),
      {
        title: "Imported Road Trip",
        sections: [{ heading: "Road Trip", detail: "12 songs", missing: [] }],
      },
    );
  });

  test("skipped entries are counted and listed under their playlist", () => {
    const summary = summarizeM3uImport([
      {
        kind: "imported",
        name: "Road Trip",
        songs: 1,
        missing: ["Portishead - Roads", "Creep.mp3"],
        replaced: true,
      },
      { kind: "imported", name: "Workout", songs: 30, missing: ["Intro.mp3"], replaced: false },
    ]);
    assert.equal(summary.title, "Imported 2 playlists");
    assert.deepEqual(summary.sections, [
      {
        heading: "Road Trip",
        detail: "Replaced · 1 song · 2 not in your library",
        missing: ["Portishead - Roads", "Creep.mp3"],
      },
      { heading: "Workout", detail: "30 songs · 1 not in your library", missing: ["Intro.mp3"] },
    ]);
  });

  test("files that made no playlist say why", () => {
    const summary = summarizeM3uImport([
      { kind: "nothingFound", file: "Old.m3u", missing: ["A.mp3", "B.mp3"] },
      { kind: "nothingFound", file: "Empty.m3u", missing: [] },
      { kind: "notPlaylist", file: "cover.jpg" },
      { kind: "unreadable", file: "Broken.m3u8" },
    ]);
    assert.equal(summary.title, "Nothing imported");
    assert.deepEqual(summary.sections, [
      {
        heading: "Old.m3u",
        detail: "None of its 2 songs are in your library",
        missing: ["A.mp3", "B.mp3"],
      },
      { heading: "Empty.m3u", detail: "It lists no songs", missing: [] },
      { heading: "cover.jpg", detail: "Not an M3U playlist", missing: [] },
      { heading: "Broken.m3u8", detail: "Couldn't be read", missing: [] },
    ]);
  });
});
