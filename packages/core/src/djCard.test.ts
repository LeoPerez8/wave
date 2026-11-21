import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { djAlbumTile, djArtistTile, djCardArtists, djGenreTile, type DjTile } from "./index.ts";

const artist = (name: string): DjTile => {
  const made = djArtistTile(name);
  assert.ok(made);
  return made;
};

const names = (faces: readonly { readonly name: string }[]) => faces.map((face) => face.name);

describe("djCardArtists", () => {
  test("shows the remembered selection's artists in the order they were selected, then the most played", () => {
    const faces = djCardArtists({
      remembered: [artist("SZA"), artist("Eminem")],
      played: [
        { id: 1, name: "Ne-Yo", countedPlays: 40 },
        { id: 2, name: "Frank Ocean", countedPlays: 30 },
        { id: 3, name: "Joji", countedPlays: 20 },
      ],
    });
    assert.deepEqual(names(faces), ["SZA", "Eminem", "Ne-Yo", "Frank Ocean"]);
  });

  test("shows an artist once, even when they were selected and are among the most played", () => {
    const faces = djCardArtists({
      remembered: [artist("Eminem")],
      played: [
        { id: 1, name: "eminem", countedPlays: 40 },
        { id: 2, name: "SZA", countedPlays: 30 },
      ],
    });
    assert.deepEqual(names(faces), ["Eminem", "SZA"]);
  });

  test("leaves out the selection's albums and genre families, which have no face", () => {
    const album = djAlbumTile({ title: "Blonde", artist: "Frank Ocean" });
    const genre = djGenreTile("Rock");
    assert.ok(album && genre);
    const faces = djCardArtists({ remembered: [album, genre, artist("Joji")], played: [] });
    assert.deepEqual(names(faces), ["Joji"]);
  });

  test("shows no one with no remembered selection and no plays", () => {
    assert.deepEqual(djCardArtists({ remembered: [], played: [] }), []);
  });

  test("leaves out a played name that isn't an artist's", () => {
    const faces = djCardArtists({
      remembered: [],
      played: [
        { id: 1, name: "Various Artists", countedPlays: 50 },
        { id: 2, name: "SZA", countedPlays: 30 },
      ],
    });
    assert.deepEqual(names(faces), ["SZA"]);
  });

  test("shows the Library's artist, whose image it has, for a remembered or played one", () => {
    const faces = djCardArtists({
      remembered: [artist("SZA")],
      played: [
        { id: 7, name: "Ne-Yo", countedPlays: 40 },
        { id: "streamed:joji", name: "Joji", countedPlays: 20 },
      ],
      artists: [{ id: 3, name: "SZA" }],
    });
    assert.deepEqual(
      faces.map((face) => [face.name, face.libraryId]),
      [
        ["SZA", 3],
        ["Ne-Yo", 7],
        ["Joji", null],
      ],
    );
  });
});
