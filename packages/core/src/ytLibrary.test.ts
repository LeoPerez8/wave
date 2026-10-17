import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  planYtLibraryImport,
  ytLibraryFailure,
  pressYtLibrarySelectAll,
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
  test("lists the account's own and saved playlists in its order, leaving out what YouTube Music generates", () => {
    const { rows } = ytLibraryPicker(library);
    assert.deepEqual(
      rows.map((row) => row.title),
      ["Road trip", "Gym", "Chill Hits"],
    );
  });

  test("each row shows the cover, the name and how many songs the library page says", () => {
    const [road, gym] = ytLibraryPicker(library).rows;
    assert.deepEqual(road, {
      playlistId: "PLroad",
      title: "Road trip",
      artworkUrl: "https://lh3.googleusercontent.com/PLroad",
      line: "1 song",
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

  test("an account with nothing but generated playlists has no rows", () => {
    assert.deepEqual(ytLibraryPicker(library.slice(0, 2)).rows, []);
  });
});

const ticked = (picker: YtLibraryPicker): string[] =>
  picker.rows.filter((row) => row.ticked).map((row) => row.playlistId);

describe("ticking rows", () => {
  test("a tap unticks a ticked row and ticks it again, leaving the others", () => {
    const picker = ytLibraryPicker(library);
    const unticked = toggleYtLibraryRow(picker, "PLgym");
    assert.deepEqual(ticked(unticked), ["PLroad", "RDCLAK5uy_chill"]);
    assert.deepEqual(ticked(toggleYtLibraryRow(unticked, "PLgym")), [
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
    const view = ytLibraryPickerView(ytLibraryPicker([]));
    assert.deepEqual(view, { selectAll: null, canImport: false });
  });
});

const names = (picker: YtLibraryPicker, playlists: readonly { readonly name: string }[] = []) =>
  planYtLibraryImport(picker, playlists).map(({ playlistId, name }) => [playlistId, name]);

describe("planYtLibraryImport", () => {
  test("makes a playlist of each ticked row, in the picker's order", () => {
    const picker = toggleYtLibraryRow(ytLibraryPicker(library), "PLgym");
    assert.deepEqual(names(picker), [
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
      ["PLspaces", "Late night"],
      ["PLblank", "Imported Playlist"],
    ]);
  });

  test("a name another playlist has goes in under Keep Both's name, without asking", () => {
    const picker = ytLibraryPicker([playlist("PLroad", "Road trip"), playlist("PLgym", "Gym")]);
    assert.deepEqual(names(picker, [{ name: "road TRIP" }, { name: "Gym" }, { name: "Gym 2" }]), [
      ["PLroad", "Road trip 2"],
      ["PLgym", "Gym 3"],
    ]);
  });

  test("two picked playlists with one name don't share it", () => {
    const picker = ytLibraryPicker([playlist("PLa", "Mix"), playlist("PLb", "Mix")]);
    assert.deepEqual(names(picker), [
      ["PLa", "Mix"],
      ["PLb", "Mix 2"],
    ]);
  });
});

describe("ytLibraryFailure", () => {
  test("offline or a failed read gives the reason and Try Again", () => {
    assert.deepEqual(ytLibraryFailure("offline"), {
      line: "You're offline. Try again when you're back online.",
      action: "tryAgain",
    });
    assert.deepEqual(ytLibraryFailure("failed"), {
      line: "Couldn't read your YouTube Music library. YouTube Music didn't answer.",
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
