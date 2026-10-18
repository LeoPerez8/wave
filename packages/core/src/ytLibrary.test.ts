import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  liveYtLibraryOrigins,
  planYtLibraryImport,
  readYtLibraryOrigins,
  writeYtLibraryOrigins,
  ytLibraryFailure,
  pressYtLibrarySelectAll,
  toggleYtLibraryFavorites,
  toggleYtLibraryRow,
  ytLibraryPicker,
  ytLibraryPickerView,
  type YtLibraryPicker,
  type YtLibraryPlaylist,
} from "./index.ts";

const playlist = (
  playlistId: string,
  title: string,
  fields: Partial<YtLibraryPlaylist> = {},
): YtLibraryPlaylist => ({
  playlistId,
  title,
  artworkUrl: `https://lh3.googleusercontent.com/${playlistId}`,
  songCount: 12,
  kind: "own",
  ...fields,
});

/** An account's library page, as YouTube Music lists it. */
const library: readonly YtLibraryPlaylist[] = [
  playlist("LM", "Liked Music", { kind: "generated", songCount: 1834 }),
  playlist("SE", "Episodes for Later", { kind: "generated", songCount: null }),
  playlist("PLroad", "Road trip", { songCount: 1 }),
  playlist("RDTMAK5uy_supermix", "My Supermix", { kind: "generated", songCount: null }),
  playlist("PLgym", "Gym", { songCount: 1234 }),
  playlist("RDCLAK5uy_chill", "Chill Hits", { kind: "saved", songCount: 50 }),
];

describe("ytLibraryPicker", () => {
  test("lists Liked Songs first, then the account's own and saved playlists in its order, leaving out what YouTube Music generates", () => {
    const { rows } = ytLibraryPicker(library);
    assert.deepEqual(
      rows.map((row) => row.title),
      ["Liked Songs", "Road trip", "Gym", "Chill Hits"],
    );
  });

  test("Liked Songs is YouTube Music's Liked music, read as LM, with its cover and count from the library page", () => {
    const [liked] = ytLibraryPicker(library).rows;
    assert.deepEqual(liked, {
      playlistId: "LM",
      title: "Liked Songs",
      artworkUrl: "https://lh3.googleusercontent.com/LM",
      line: "1,834 songs",
      imported: false,
      ticked: true,
    });
  });

  test("Liked Songs is listed even for an account with no playlists", () => {
    assert.deepEqual(ytLibraryPicker([]).rows, [
      {
        playlistId: "LM",
        title: "Liked Songs",
        artworkUrl: null,
        line: null,
        imported: false,
        ticked: true,
      },
    ]);
  });

  test("each row shows the cover, the name and how many songs the library page says", () => {
    const [, road, gym] = ytLibraryPicker(library).rows;
    assert.deepEqual(road, {
      playlistId: "PLroad",
      title: "Road trip",
      artworkUrl: "https://lh3.googleusercontent.com/PLroad",
      line: "1 song",
      imported: false,
      ticked: true,
    });
    assert.equal(gym?.line, "1,234 songs");
  });

  test("a playlist whose count the page doesn't give has no line", () => {
    const [row] = ytLibraryPicker([playlist("PLx", "Mystery", { songCount: null })]).rows;
    assert.equal(row?.line, null);
  });

  test("every row starts ticked", () => {
    assert.ok(ytLibraryPicker(library).rows.every((row) => row.ticked));
  });

  test("a playlist already imported on this phone shows Imported and starts unticked", () => {
    const origins = new Map([["PLgym", 7]]);
    const rows = ytLibraryPicker(library, origins).rows.map(({ playlistId, imported, ticked }) => ({
      playlistId,
      imported,
      ticked,
    }));
    assert.deepEqual(rows, [
      { playlistId: "LM", imported: false, ticked: true },
      { playlistId: "PLroad", imported: false, ticked: true },
      { playlistId: "PLgym", imported: true, ticked: false },
      { playlistId: "RDCLAK5uy_chill", imported: false, ticked: true },
    ]);
  });

  test("Liked Songs imported on this phone shows Imported and starts unticked too", () => {
    const [liked] = ytLibraryPicker(library, new Map([["LM", 9]])).rows;
    assert.deepEqual([liked?.title, liked?.imported, liked?.ticked], ["Liked Songs", true, false]);
  });

  test("an account with nothing but generated playlists lists only Liked Songs", () => {
    assert.deepEqual(
      ytLibraryPicker(library.slice(0, 2)).rows.map((row) => row.title),
      ["Liked Songs"],
    );
  });
});

const ticked = (picker: YtLibraryPicker): string[] =>
  picker.rows.filter((row) => row.ticked).map((row) => row.playlistId);

describe("ticking rows", () => {
  test("a tap unticks a ticked row and ticks it again, leaving the others", () => {
    const picker = ytLibraryPicker(library);
    const unticked = toggleYtLibraryRow(picker, "PLgym");
    assert.deepEqual(ticked(unticked), ["LM", "PLroad", "RDCLAK5uy_chill"]);
    assert.deepEqual(ticked(toggleYtLibraryRow(unticked, "PLgym")), [
      "LM",
      "PLroad",
      "PLgym",
      "RDCLAK5uy_chill",
    ]);
  });

  test("with every row ticked the button says Deselect All, and unticks them all", () => {
    const picker = ytLibraryPicker(library);
    assert.equal(ytLibraryPickerView(picker).selectAll, "Deselect All");
    assert.deepEqual(ticked(pressYtLibrarySelectAll(picker)), []);
  });

  test("with any row unticked the button says Select All, and ticks them all", () => {
    const picker = toggleYtLibraryRow(ytLibraryPicker(library), "PLroad");
    assert.equal(ytLibraryPickerView(picker).selectAll, "Select All");
    assert.deepEqual(ticked(pressYtLibrarySelectAll(picker)), [
      "LM",
      "PLroad",
      "PLgym",
      "RDCLAK5uy_chill",
    ]);
    const none = pressYtLibrarySelectAll(ytLibraryPicker(library));
    assert.equal(ytLibraryPickerView(none).selectAll, "Select All");
  });

  test("Import works only while a row is ticked", () => {
    const picker = ytLibraryPicker(library);
    assert.equal(ytLibraryPickerView(picker).canImport, true);
    assert.equal(ytLibraryPickerView(pressYtLibrarySelectAll(picker)).canImport, false);
    assert.equal(
      ytLibraryPickerView(toggleYtLibraryRow(pressYtLibrarySelectAll(picker), "PLgym")).canImport,
      true,
    );
  });

  test("with no rows there is nothing to select or import", () => {
    const view = ytLibraryPickerView({ rows: [], origins: new Map(), favorites: false });
    assert.deepEqual(view, {
      selectAll: null,
      canImport: false,
      favorites: { on: false, enabled: false },
    });
  });
});

/** Wave's playlists, numbered from 1 in this order. */
const wave = (...names: readonly string[]) => names.map((name, index) => ({ id: index + 1, name }));

const names = (picker: YtLibraryPicker, playlists: readonly string[] = []) =>
  planYtLibraryImport(picker, wave(...playlists)).map(({ playlistId, name }) => [playlistId, name]);

describe("planYtLibraryImport", () => {
  test("makes a playlist of each ticked row, in the picker's order", () => {
    const picker = toggleYtLibraryRow(ytLibraryPicker(library), "PLgym");
    assert.deepEqual(names(picker), [
      ["LM", "Liked Songs"],
      ["PLroad", "Road trip"],
      ["RDCLAK5uy_chill", "Chill Hits"],
    ]);
  });

  test("with no row ticked it makes nothing", () => {
    assert.deepEqual(names(pressYtLibrarySelectAll(ytLibraryPicker(library))), []);
  });

  test("names each as a link import does: trimmed to a playlist name, or Imported Playlist", () => {
    const picker = ytLibraryPicker([
      playlist("PLspaces", "  Late   night  "),
      playlist("PLblank", "   "),
    ]);
    assert.deepEqual(names(picker), [
      ["LM", "Liked Songs"],
      ["PLspaces", "Late night"],
      ["PLblank", "Imported Playlist"],
    ]);
  });

  test("a name another playlist has goes in under Keep Both's name, without asking", () => {
    const picker = ytLibraryPicker([playlist("PLroad", "Road trip"), playlist("PLgym", "Gym")]);
    assert.deepEqual(names(picker, ["road TRIP", "Gym", "Gym 2"]), [
      ["LM", "Liked Songs"],
      ["PLroad", "Road trip 2"],
      ["PLgym", "Gym 3"],
    ]);
  });

  test("two picked playlists with one name don't share it", () => {
    const picker = ytLibraryPicker([playlist("PLa", "Mix"), playlist("PLb", "Mix")]);
    assert.deepEqual(names(picker), [
      ["LM", "Liked Songs"],
      ["PLa", "Mix"],
      ["PLb", "Mix 2"],
    ]);
  });

  test("Liked Songs goes in as Liked Songs, under Keep Both's name when one has it", () => {
    const picker = ytLibraryPicker([playlist("PLliked", "Liked Songs", { kind: "saved" })]);
    assert.deepEqual(names(picker, ["liked songs"]), [
      ["LM", "Liked Songs 2"],
      ["PLliked", "Liked Songs 3"],
    ]);
  });

  test("Liked Songs is read whole; the other playlists stop at the cap", () => {
    const plan = planYtLibraryImport(ytLibraryPicker(library), []);
    assert.deepEqual(
      plan.map(({ playlistId, uncapped }) => [playlistId, uncapped]),
      [
        ["LM", true],
        ["PLroad", false],
        ["PLgym", false],
        ["RDCLAK5uy_chill", false],
      ],
    );
  });
});

describe("importing again", () => {
  /** Gym was imported on this phone as Wave's playlist 2. */
  const origins = new Map([["PLgym", 2]]);

  test("an Imported row ticked again refreshes the playlist it made, under its name in Wave, and makes no second one", () => {
    const picker = toggleYtLibraryRow(ytLibraryPicker(library, origins), "PLgym");
    assert.deepEqual(planYtLibraryImport(picker, wave("Road trip", "Gym workout")), [
      { playlistId: "LM", name: "Liked Songs", replaces: null, uncapped: true, favorites: false },
      {
        playlistId: "PLroad",
        name: "Road trip 2",
        replaces: null,
        uncapped: false,
        favorites: false,
      },
      { playlistId: "PLgym", name: "Gym workout", replaces: 2, uncapped: false, favorites: false },
      {
        playlistId: "RDCLAK5uy_chill",
        name: "Chill Hits",
        replaces: null,
        uncapped: false,
        favorites: false,
      },
    ]);
  });

  test("Liked Songs ticked again refreshes its playlist, still read whole", () => {
    const picker = toggleYtLibraryRow(ytLibraryPicker([], new Map([["LM", 4]])), "LM");
    assert.deepEqual(planYtLibraryImport(picker, wave("Road trip", "Gym", "Chill", "My Likes")), [
      { playlistId: "LM", name: "My Likes", replaces: 4, uncapped: true, favorites: false },
    ]);
  });

  test("an Imported row left unticked is left alone", () => {
    const plan = planYtLibraryImport(ytLibraryPicker(library, origins), wave("Road trip", "Gym"));
    assert.deepEqual(
      plan.map((item) => item.playlistId),
      ["LM", "PLroad", "RDCLAK5uy_chill"],
    );
  });

  test("a playlist gone since its import is made again, under Keep Both's name on a clash", () => {
    const picker = toggleYtLibraryRow(ytLibraryPicker(library, origins), "PLgym");
    const plan = planYtLibraryImport(picker, [{ id: 5, name: "Gym" }]);
    assert.deepEqual(
      plan.find((item) => item.playlistId === "PLgym"),
      { playlistId: "PLgym", name: "Gym 2", replaces: null, uncapped: false, favorites: false },
    );
  });
});

/** Each playlist [picker]'s Import makes, and whether its read stars. */
const starred = (picker: YtLibraryPicker) =>
  planYtLibraryImport(picker, []).map(({ playlistId, favorites }) => [playlistId, favorites]);

describe("Also add to Favorites", () => {
  test("is off when the picker opens, and works while Liked Songs is ticked", () => {
    const picker = ytLibraryPicker(library);
    assert.deepEqual(ytLibraryPickerView(picker).favorites, { on: false, enabled: true });
    const on = toggleYtLibraryFavorites(picker);
    assert.deepEqual(ytLibraryPickerView(on).favorites, { on: true, enabled: true });
    assert.deepEqual(ytLibraryPickerView(toggleYtLibraryFavorites(on)).favorites, {
      on: false,
      enabled: true,
    });
  });

  test("unticking Liked Songs disables it and shows it off; ticking it again brings the choice back", () => {
    const on = toggleYtLibraryFavorites(ytLibraryPicker(library));
    const unticked = toggleYtLibraryRow(on, "LM");
    assert.deepEqual(ytLibraryPickerView(unticked).favorites, { on: false, enabled: false });
    assert.deepEqual(ytLibraryPickerView(toggleYtLibraryRow(unticked, "LM")).favorites, {
      on: true,
      enabled: true,
    });
    const deselected = pressYtLibrarySelectAll(on);
    assert.deepEqual(ytLibraryPickerView(deselected).favorites, { on: false, enabled: false });
  });

  test("off, Import stars nothing", () => {
    assert.deepEqual(starred(ytLibraryPicker(library)), [
      ["LM", false],
      ["PLroad", false],
      ["PLgym", false],
      ["RDCLAK5uy_chill", false],
    ]);
  });

  test("on, Import stars Liked Songs' songs and no other playlist's", () => {
    assert.deepEqual(starred(toggleYtLibraryFavorites(ytLibraryPicker(library))), [
      ["LM", true],
      ["PLroad", false],
      ["PLgym", false],
      ["RDCLAK5uy_chill", false],
    ]);
  });

  test("on, Liked Songs imported again still stars", () => {
    const picker = toggleYtLibraryFavorites(
      toggleYtLibraryRow(ytLibraryPicker([], new Map([["LM", 1]])), "LM"),
    );
    assert.deepEqual(planYtLibraryImport(picker, wave("My Likes")), [
      { playlistId: "LM", name: "My Likes", replaces: 1, uncapped: true, favorites: true },
    ]);
  });

  test("can't be turned on while Liked Songs is unticked", () => {
    const unticked = toggleYtLibraryRow(ytLibraryPicker(library), "LM");
    const pressed = toggleYtLibraryFavorites(unticked);
    assert.deepEqual(ytLibraryPickerView(toggleYtLibraryRow(pressed, "LM")).favorites, {
      on: false,
      enabled: true,
    });
  });
});

describe("origins", () => {
  test("once its playlist is deleted, here or on another phone, a row is ticked and unmarked again", () => {
    const origins = liveYtLibraryOrigins(
      new Map([
        ["PLgym", 2],
        ["PLroad", 1],
      ]),
      wave("Road trip"),
    );
    const rows = ytLibraryPicker(library, origins).rows;
    assert.deepEqual(
      rows.map((row) => [row.playlistId, row.imported, row.ticked]),
      [
        ["LM", false, true],
        ["PLroad", true, false],
        ["PLgym", false, true],
        ["RDCLAK5uy_chill", false, true],
      ],
    );
    assert.deepEqual([...origins], [["PLroad", 1]]);
  });

  test("are kept and read back, Liked Songs' among them", () => {
    const origins = new Map([
      ["LM", 9],
      ["PLgym", 2],
    ]);
    assert.deepEqual(readYtLibraryOrigins(writeYtLibraryOrigins(origins)), origins);
  });

  test("nothing kept, or anything unreadable, is no origins", () => {
    for (const stored of [
      null,
      "",
      "{",
      "[]",
      '"x"',
      '{"version":1}',
      '{"version":99,"origins":{"PLgym":2}}',
    ]) {
      assert.deepEqual(readYtLibraryOrigins(stored), new Map(), String(stored));
    }
  });

  test("an origin kept wrong is dropped, the others kept", () => {
    const stored = JSON.stringify({
      version: 1,
      origins: { PLgym: 2, PLbad: "3", PLneg: -1, PLfrac: 1.5, PLroad: 1 },
    });
    assert.deepEqual(
      readYtLibraryOrigins(stored),
      new Map([
        ["PLgym", 2],
        ["PLroad", 1],
      ]),
    );
  });
});

describe("ytLibraryFailure", () => {
  test("offline or a failed read gives the reason and Try Again", () => {
    assert.deepEqual(ytLibraryFailure("offline"), {
      line: "You're offline. Try again when you're back online.",
      action: "tryAgain",
    });
    assert.deepEqual(ytLibraryFailure("failed"), {
      line: "Couldn't read your YouTube Music library. No answer online.",
      action: "tryAgain",
    });
  });

  test("an expired session says so and offers to sign in again", () => {
    assert.deepEqual(ytLibraryFailure("signedOut"), {
      line: "Your YouTube session ended. Sign in again to see your playlists.",
      action: "signIn",
    });
  });

  test("YT Music turned off meanwhile offers nothing", () => {
    assert.deepEqual(ytLibraryFailure("disabled"), {
      line: "YT Music is off in Settings.",
      action: null,
    });
  });
});
