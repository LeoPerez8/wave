import assert from "node:assert/strict";
import { test } from "node:test";

import { streamedCredits } from "./streamedCredits.ts";

test("a streamed collaboration credits each artist once and matches the Library release", () => {
  const resolve = streamedCredits({
    artists: [{ id: 1, name: "Beyoncé" }],
    albums: [{ id: 7, title: "Lemonade", albumArtistIds: [1] }],
    credits: ["Beyoncé", "Earth, Wind & Fire"],
  });
  const credits = resolve({
    artists: ["BEYONCE feat. James Blake", "James Blake"],
    album: "Lemonade (Deluxe Edition)",
    albumId: "release",
    artworkUrl: "cover",
  });
  assert.deepEqual(credits.artists, [
    { id: 1, name: "Beyoncé" },
    { id: "artist:james blake", name: "James Blake" },
  ]);
  assert.equal(credits.album?.id, 7);
});

test("online releases group editions, keep live releases separate and preserve whole band credits", () => {
  const resolve = streamedCredits({ artists: [], albums: [], credits: ["Earth, Wind & Fire"] });
  const song = { artists: ["Earth, Wind & Fire"], album: "Spirit", artworkUrl: "cover" };
  const plain = resolve(song);
  assert.deepEqual(plain.artists.map((artist) => artist.name), ["Earth, Wind & Fire"]);
  assert.equal(resolve({ ...song, album: "Spirit (Deluxe)" }).album?.id, plain.album?.id);
  assert.notEqual(resolve({ ...song, album: "Spirit (Live)" }).album?.id, plain.album?.id);
  assert.notEqual(resolve({ ...song, artists: ["Other"] }).album?.id, plain.album?.id);
  assert.equal(resolve({ ...song, album: null }).album, null);
});
