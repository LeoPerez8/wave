import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addExportedPlaylist,
  catalogueOf,
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
  ytExportSignInAlert,
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
  current.rows
    .filter((row) => row.ticked)
    .map((row) => (row.kind === "favorites" ? "Favorites" : row.playlist.name));

describe("ytExportPicker", () => {
  test("lists every playlist in the order given, with its song count", () => {
    assert.deepEqual(
      picker.rows
        .filter((row) => row.kind === "playlist")
        .map((row) => [row.playlist.name, row.line]),
      [
        ["Road trip", "12 songs"],
        ["Liked Songs", "430 songs"],
        ["Gym", "1 song"],
        ["Empty", "0 songs"],
      ],
    );
  });

  test("ticks every playlist but those that came from YT Music; Spotify imports are ticked", () => {
    assert.deepEqual(ticked(picker), ["Favorites", "Road trip", "Gym", "Empty"]);
    assert.deepEqual(
      picker.rows.filter((row) => row.kind === "playlist").map((row) => row.fromYtMusic),
      [false, true, false, false],
    );
  });

  test("reads the origins as the key-value store keeps them", () => {
    const kept = readYtLibraryOrigins(writeYtLibraryOrigins(origins));
    assert.deepEqual(ticked(ytExportPicker([road, liked, gym], kept)), [
      "Favorites",
      "Road trip",
      "Gym",
    ]);
  });

  test("ticks every playlist with no origins", () => {
    assert.deepEqual(ticked(ytExportPicker([road, liked])), [
      "Favorites",
      "Road trip",
      "Liked Songs",
    ]);
  });

  test("says the counts in Portuguese", () => {
    assert.deepEqual(
      ytExportPicker([road, gym, empty], new Map(), "pt-BR")
        .rows.filter((row) => row.kind === "playlist")
        .map((row) => row.line),
      ["12 músicas", "1 música", "Nenhuma música"],
    );
  });

  test("keys each row by its playlist", () => {
    assert.deepEqual(
      picker.rows.map((row) => row.key),
      ["favorites", "playlist:1", "playlist:2", "playlist:3", "playlist:4"],
    );
  });
});

describe("the export picker's ticks", () => {
  test("a tap ticks an unticked row and unticks a ticked one", () => {
    const toggled = toggleYtExportRow(toggleYtExportRow(picker, "playlist:2"), "playlist:1");
    assert.deepEqual(ticked(toggled), ["Favorites", "Liked Songs", "Gym", "Empty"]);
  });

  test("Select All ticks every row, then Deselect All unticks them", () => {
    assert.equal(ytExportPickerView(picker).selectAll, "Select All");
    const all = pressYtExportSelectAll(picker);
    assert.deepEqual(ticked(all), ["Favorites", "Road trip", "Liked Songs", "Gym", "Empty"]);
    assert.equal(ytExportPickerView(all).selectAll, "Deselect All");
    const none = pressYtExportSelectAll(all);
    assert.deepEqual(ticked(none), []);
    assert.equal(ytExportPickerView(none).canExport, false);
  });

  test("Export does something only while a row is ticked", () => {
    assert.equal(ytExportPickerView(picker).canExport, true);
  });

  test("offers Favorites even without playlists", () => {
    const bare = ytExportPicker([]);
    assert.deepEqual(ytExportPickerView(bare), { selectAll: "Deselect All", canExport: true });
  });
});

describe("planYtExport", () => {
  test("exports the ticked playlists in the picker's order", () => {
    const chosen = toggleYtExportRow(toggleYtExportRow(picker, "playlist:4"), "playlist:2");
    assert.deepEqual(planYtExport(chosen), [
      { kind: "favorites" },
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
      { ids: ["a"], found: 12, total: 12 },
      { ids: ["b"], found: 400, total: 418 },
    ].reduce(addExportedPlaylist, NO_YT_EXPORT);
    assert.deepEqual(summary, { playlists: 2, found: 412, total: 430, liked: null });
  });

  test("a playlist with no song found isn't exported, as Share makes nothing, but its songs count", () => {
    const summary = [
      { ids: ["a"], found: 2, total: 3 },
      { ids: [], found: 0, total: 5 },
    ].reduce(addExportedPlaylist, NO_YT_EXPORT);
    assert.deepEqual(summary, { playlists: 1, found: 2, total: 8, liked: null });
    assert.equal(ytExportSummaryLine(summary), "1 playlist exported · 2 of 8 songs found");
  });

  test("says it in one line, without likes when Favorites wasn't exported", () => {
    assert.equal(
      ytExportSummaryLine({ playlists: 8, found: 412, total: 430, liked: null }),
      "8 playlists exported · 412 of 430 songs found",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 1, found: 1, total: 1, liked: null }),
      "1 playlist exported · 1 of 1 song found",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 1, found: 1_200, total: 1_234, liked: null }, "pt-BR"),
      "1 playlist exportada · 1.200 de 1.234 músicas encontradas",
    );
  });

  test("counts likes once Favorites was exported, none liked included", () => {
    assert.equal(
      ytExportSummaryLine({ playlists: 8, found: 412, total: 430, liked: 1_023 }),
      "8 playlists exported · 412 of 430 songs found · 1,023 liked",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 1, found: 1, total: 1, liked: 1 }),
      "1 playlist exported · 1 of 1 song found · 1 liked",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 0, found: 0, total: 2, liked: 0 }),
      "0 playlists exported · 0 of 2 songs found · 0 liked",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 3, found: 1, total: 2, liked: 1 }, "pt-BR"),
      "3 playlists exportadas · 1 de 2 músicas encontradas · 1 curtida",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 3, found: 0, total: 2, liked: 0 }, "pt-BR"),
      "3 playlists exportadas · 0 de 2 músicas encontradas · 0 curtidas",
    );
    assert.equal(
      ytExportSummaryLine({ playlists: 1, found: 1_200, total: 1_234, liked: 1_200 }, "pt-BR"),
      "1 playlist exportada · 1.200 de 1.234 músicas encontradas · 1.200 curtidas",
    );
  });
});

describe("Export's sign-in", () => {
  test("asks as Share does, under the same title and button, saying what Export makes", () => {
    const alert = ytExportSignInAlert();
    assert.equal(alert.title, "Sign In to YT Music");
    assert.equal(alert.action.label, "Sign In");
    assert.match(alert.message ?? "", /private/);
    const ptBr = ytExportSignInAlert(catalogueOf("pt-BR"));
    assert.equal(ptBr.title, "Iniciar Sessão no YT Music");
    assert.equal(ptBr.action.label, "Iniciar Sessão");
    assert.match(ptBr.message ?? "", /privad/);
  });
});

describe("an exporting playlist's progress", () => {
  test("waits, then counts its songs as they're matched", () => {
    assert.equal(importProgressLine(EXPORT_WAITING_PROGRESS), "Waiting to export");
    assert.equal(importProgressLine(exportingProgress(120, 1_430)), "Exporting 120 of 1,430");
    assert.equal(importProgressLine(EXPORT_WAITING_PROGRESS, "pt-BR"), "Aguardando exportação");
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

  test("Share leaves one whose page it can't read alone, so a public one is never narrowed", () => {
    assert.equal(ytPrivacyChange("share", null), null);
    assert.equal(ytPrivacyChange("share", "SOMETHING_NEW"), null);
  });

  test("Export never changes a playlist's visibility", () => {
    for (const privacy of ["PRIVATE", "UNLISTED", "PUBLIC", null])
      assert.equal(ytPrivacyChange("export", privacy), null);
  });
});

test("Favorites starts ticked before playlists and can export alone", () => {
  const favorites = ytExportPicker([]);
  assert.deepEqual(planYtExport(favorites), [{ kind: "favorites" }]);
  assert.equal(favorites.rows[0]?.key, "favorites");
  assert.deepEqual(planYtExport(toggleYtExportRow(favorites, "favorites")), []);
});

test("likes favorites oldest first, counts not found, and counts likes in both languages", async () => {
  const { exportYtFavorites, addYtLikes } = await import("./ytExport.ts");
  const liked: string[] = [];
  const progress: number[] = [];
  const songs = await exportYtFavorites(
    [
      { starredAt: 30, song: { id: "new" } },
      { starredAt: 10, song: { id: null, search: "old" } },
      { starredAt: 20, song: { id: null, search: "absent" } },
    ],
    async (query) => (query === "old" ? "old-id" : null),
    async (id) => {
      liked.push(id);
    },
    undefined,
    (done) => progress.push(done),
  );
  assert.deepEqual(liked, ["old-id", "new"]);
  assert.deepEqual(progress, [0, 1, 2, 3]);
  const summary = addYtLikes(NO_YT_EXPORT, songs);
  assert.deepEqual(summary, { playlists: 0, found: 2, total: 3, liked: 2 });
  assert.equal(ytExportSummaryLine(summary), "0 playlists exported · 2 of 3 songs found · 2 liked");
  assert.equal(
    ytExportSummaryLine(summary, "pt-BR"),
    "Nenhuma playlist exportada · 2 de 3 músicas encontradas · 2 curtidas",
  );
});

test("favorites remember searched matches and like a repeated video only once", async () => {
  const { exportYtFavorites } = await import("./ytExport.ts");
  const remembered: [number, string][] = [];
  const likes: string[] = [];
  const result = await exportYtFavorites(
    [
      { starredAt: 1, song: { id: null, search: "song", rememberAs: 42 } },
      { starredAt: 2, song: { id: "same" } },
    ],
    async () => "same",
    async (id) => {
      likes.push(id);
    },
    async (track, video) => {
      remembered.push([track, video]);
    },
  );
  assert.deepEqual(remembered, [[42, "same"]]);
  assert.deepEqual(likes, ["same"]);
  assert.deepEqual(result, { ids: ["same"], found: 2, total: 2 });
});

test("a failed like stops before searching or liking a later favorite", async () => {
  const { exportYtFavorites } = await import("./ytExport.ts");
  let searched = false;
  await assert.rejects(
    exportYtFavorites(
      [
        { starredAt: 1, song: { id: "known" } },
        { starredAt: 2, song: { id: null, search: "later" } },
      ],
      async () => {
        searched = true;
        return "later";
      },
      async () => {
        throw new Error("signed out");
      },
    ),
    /signed out/,
  );
  assert.equal(searched, false);
});
