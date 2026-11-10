import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addYtExported,
  EXPORT_WAITING_PROGRESS,
  exportingProgress,
  importProgressFraction,
  importProgressLine,
  importRing,
  matchSharedSongs,
  NO_YT_EXPORT,
  planYtExport,
  pressYtExportSelectAll,
  readYtLibraryOrigins,
  toggleYtExportRow,
  writeYtLibraryOrigins,
  ytExportPicker,
  ytExportPickerView,
  ytExportSummaryLine,
  ytNewPlaylistPrivacy,
  ytPrivacyChange,
  type YtExportPicker,
} from "./index.ts";

const playlist = (id: number, name: string, trackCount = 10) => ({ id, name, trackCount });

const road = playlist(1, "Road trip", 12);
const liked = playlist(2, "Liked Songs", 430);
const gym = playlist(3, "Gym", 1);
const empty = playlist(4, "Empty", 0);

/** Liked Songs came From YT Music, Gym From Spotify. */
const origins = new Map([
  ["LM", 2],
  ["spotify:playlist:abc", 3],
]);

const picker = ytExportPicker([road, liked, gym, empty], origins);

const ticked = (current: YtExportPicker) =>
  current.rows.filter((row) => row.ticked).map((row) => row.playlist.name);

describe("ytExportPicker", () => {
  test("lists every playlist in the order given, with its song count", () => {
    assert.deepEqual(
      picker.rows.map((row) => [row.playlist.name, row.line]),
      [
        ["Road trip", "12 songs"],
        ["Liked Songs", "430 songs"],
        ["Gym", "1 song"],
        ["Empty", "0 songs"],
      ],
    );
  });

  test("ticks every playlist but those that came from YT Music; Spotify imports are ticked", () => {
    assert.deepEqual(ticked(picker), ["Road trip", "Gym", "Empty"]);
    assert.deepEqual(
      picker.rows.map((row) => row.fromYtMusic),
      [false, true, false, false],
    );
  });

  test("reads the origins as the key-value store keeps them", () => {
    const kept = readYtLibraryOrigins(writeYtLibraryOrigins(origins));
    assert.deepEqual(ticked(ytExportPicker([road, liked, gym], kept)), ["Road trip", "Gym"]);
  });

  test("ticks every playlist with no origins", () => {
    assert.deepEqual(ticked(ytExportPicker([road, liked])), ["Road trip", "Liked Songs"]);
  });

  test("says the counts in Portuguese", () => {
    assert.deepEqual(
      ytExportPicker([road, gym, empty], new Map(), "pt-BR").rows.map((row) => row.line),
      ["12 músicas", "1 música", "Nenhuma música"],
    );
  });

  test("keys each row by its playlist", () => {
    assert.deepEqual(
      picker.rows.map((row) => row.key),
      ["playlist:1", "playlist:2", "playlist:3", "playlist:4"],
    );
  });
});

describe("the export picker's ticks", () => {
  test("a tap ticks an unticked row and unticks a ticked one", () => {
    const toggled = toggleYtExportRow(toggleYtExportRow(picker, "playlist:2"), "playlist:1");
    assert.deepEqual(ticked(toggled), ["Liked Songs", "Gym", "Empty"]);
  });

  test("Select All ticks every row, then Deselect All unticks them", () => {
    assert.equal(ytExportPickerView(picker).selectAll, "Select All");
    const all = pressYtExportSelectAll(picker);
    assert.deepEqual(ticked(all), ["Road trip", "Liked Songs", "Gym", "Empty"]);
    assert.equal(ytExportPickerView(all).selectAll, "Deselect All");
    const none = pressYtExportSelectAll(all);
    assert.deepEqual(ticked(none), []);
    assert.equal(ytExportPickerView(none).canExport, false);
  });

  test("Export does something only while a row is ticked", () => {
    assert.equal(ytExportPickerView(picker).canExport, true);
  });

  test("offers no Select All without playlists", () => {
    const bare = ytExportPicker([]);
    assert.deepEqual(ytExportPickerView(bare), { selectAll: null, canExport: false });
  });
});

describe("planYtExport", () => {
  test("exports the ticked playlists in the picker's order", () => {
    const chosen = toggleYtExportRow(toggleYtExportRow(picker, "playlist:4"), "playlist:2");
    assert.deepEqual(planYtExport(chosen), [
      { kind: "playlist", playlistId: 1, name: "Road trip" },
      { kind: "playlist", playlistId: 2, name: "Liked Songs" },
      { kind: "playlist", playlistId: 3, name: "Gym" },
    ]);
  });

  test("exports nothing with nothing ticked", () => {
    assert.deepEqual(planYtExport(pressYtExportSelectAll(pressYtExportSelectAll(picker))), []);
  });
});

describe("the export's summary", () => {
  test("adds up the playlists exported and their songs found", () => {
    const summary = [
      { found: 12, total: 12 },
      { found: 400, total: 418 },
    ].reduce(addYtExported, NO_YT_EXPORT);
    assert.deepEqual(summary, { playlists: 2, found: 412, total: 430 });
  });

  test("says it in one line", () => {
    assert.equal(
      ytExportSummaryLine({ playlists: 8, found: 412, total: 430 }),
      "8 playlists exported · 412 of 430 songs found",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 1, found: 1, total: 1 }),
      "1 playlist exported · 1 of 1 song found",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 1, found: 1_200, total: 1_234 }, "pt-BR"),
      "1 playlist exportada · 1.200 de 1.234 músicas encontradas",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 3, found: 0, total: 2 }, "pt-BR"),
      "3 playlists exportadas · 0 de 2 músicas encontradas",
    );
  });
});

describe("an exporting playlist's progress", () => {
  test("waits, then counts its songs as they're matched", () => {
    assert.equal(importProgressLine(EXPORT_WAITING_PROGRESS), "Waiting to export");
    assert.equal(importProgressLine(exportingProgress(120, 1_430)), "Exporting 120 of 1,430");
    assert.equal(
      importProgressLine(EXPORT_WAITING_PROGRESS, "pt-BR"),
      "Aguardando exportação",
    );
    assert.equal(
      importProgressLine(exportingProgress(120, 1_430), "pt-BR"),
      "Exportando 120 de 1.430",
    );
  });

  test("fills the ring as its songs are matched", () => {
    assert.deepEqual(importRing(EXPORT_WAITING_PROGRESS), { fraction: 0, pulses: false });
    assert.equal(importProgressFraction(exportingProgress(1, 4)), 0.25);
    assert.equal(importProgressFraction(exportingProgress(0, 0)), 1);
  });

  test("matching reports each song done", async () => {
    const done: number[] = [];
    await matchSharedSongs(
      [{ id: "a" }, { id: null, search: "b" }, { id: null }],
      () => Promise.resolve("yt-b"),
      undefined,
      (count) => done.push(count),
    );
    assert.deepEqual(done, [1, 2, 3]);
  });
});

describe("a YT Music playlist's visibility", () => {
  test("Share makes it unlisted, Export private", () => {
    assert.equal(ytNewPlaylistPrivacy("share"), "UNLISTED");
    assert.equal(ytNewPlaylistPrivacy("export"), "PRIVATE");
  });

  test("Share turns a private playlist unlisted, and leaves an unlisted or public one", () => {
    assert.equal(ytPrivacyChange("share", "PRIVATE"), "UNLISTED");
    assert.equal(ytPrivacyChange("share", "UNLISTED"), null);
    assert.equal(ytPrivacyChange("share", "PUBLIC"), null);
  });

  test("Share makes one it can't tell unlisted, so its link opens", () => {
    assert.equal(ytPrivacyChange("share", null), "UNLISTED");
  });

  test("Export never changes a playlist's visibility", () => {
    for (const privacy of ["PRIVATE", "UNLISTED", "PUBLIC", null])
      assert.equal(ytPrivacyChange("export", privacy), null);
  });
});
