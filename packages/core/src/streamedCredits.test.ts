import assert from "node:assert/strict";
import { test } from "node:test";

import { pickStreamedAlbum, streamedCredits } from "./streamedCredits.ts";

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
  assert.deepEqual(
    plain.artists.map((artist) => artist.name),
    ["Earth, Wind & Fire"],
  );
  assert.equal(resolve({ ...song, album: "Spirit (Deluxe)" }).album?.id, plain.album?.id);
  assert.notEqual(resolve({ ...song, album: "Spirit (Live)" }).album?.id, plain.album?.id);
  assert.notEqual(resolve({ ...song, artists: ["Other"] }).album?.id, plain.album?.id);
  assert.equal(resolve({ ...song, album: null }).album, null);
});

test("a plain streamed album opens the matching online release, never a namesake or live edition", () => {
  const album = { title: "Spirit", artists: ["Earth, Wind & Fire"] };
  const other = { title: "Spirit", artists: ["Other"], browseId: "wrong" };
  const live = { title: "Spirit (Live)", artists: album.artists, browseId: "live" };
  const right = { title: "Spirit (Deluxe)", artists: ["Earth Wind and Fire"], browseId: "right" };
  assert.equal(pickStreamedAlbum(album, [other, live, right]), "right");
  assert.equal(pickStreamedAlbum(album, [other, live]), null);
});

test("songs with different credits on one online compilation share its album", () => {
  const resolve = streamedCredits({ artists: [], albums: [], credits: [] });
  const album = { album: "Compilation", albumId: "same-release", artworkUrl: "cover" };
  assert.equal(
    resolve({ ...album, artists: ["A"] }).album?.id,
    resolve({ ...album, artists: ["B"] }).album?.id,
  );
});

test("a plain album joins a known online release even when its songs are read first", () => {
  const release = {
    album: "Spirit",
    albumId: "known-release",
    artists: ["Band"],
    artworkUrl: "cover",
  };
  const resolve = streamedCredits({ artists: [], albums: [], credits: [], releases: [release] });
  assert.equal(resolve({ ...release, albumId: null }).album?.id, resolve(release).album?.id);
  assert.equal(resolve({ ...release, albumId: null }).album?.albumId, "known-release");
});
