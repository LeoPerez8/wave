import assert from "node:assert/strict";
import { test } from "node:test";

import { finishSteps } from "./buildSteps.ts";
import { libraryArtistFinder, libraryReleaseFinder } from "./ytArtist.ts";
import {
  pickStreamedAlbum,
  streamedCreditResolverSteps,
  streamedCredits,
} from "./streamedCredits.ts";

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

/** A Library of [size] artists, albums and credits, and streamed songs naming some of them. */
const sizedLibrary = (size: number) => ({
  artists: Array.from({ length: size }, (_, i) => ({ id: i + 1, name: `Artist ${i}` })),
  albums: Array.from({ length: size }, (_, i) => ({
    id: i + 1,
    title: `Album ${i % 97} (Deluxe)`,
    albumArtistIds: [i + 1, ((i * 7) % size) + 1],
  })),
  credits: Array.from({ length: size }, (_, i) => `Artist ${i} & Artist ${(i * 3) % size}`),
  releases: Array.from({ length: size / 4 }, (_, i) => ({
    artists: [`Artist ${i} feat. Guest ${i % 5}`],
    album: `Album ${i % 97}`,
    albumId: `MPREb_${i % 31}`,
    artworkUrl: null,
  })),
});

const someSongs = (size: number) =>
  Array.from({ length: 200 }, (_, i) => ({
    artists: [`Artist ${(i * 13) % size} & Artist ${(i * 3) % size}`, `Guest ${i % 5}`],
    album: i % 9 === 0 ? null : `Album ${i % 97}`,
    albumId: i % 2 === 0 ? null : `MPREb_${i % 31}`,
    artworkUrl: null,
  }));

test("the resolver builds in many small steps and resolves as the whole build does", () => {
  const library = sizedLibrary(400);
  const whole = streamedCredits(library);
  const steps = streamedCreditResolverSteps(library);
  let taken = 0;
  let next = steps.next();
  for (; next.done !== true; next = steps.next()) taken++;
  // A step per credit, artist, album and release: none holds the thread for the whole Library.
  assert.ok(taken >= 400 * 3, `only ${taken} steps`);
  // The album index built up front finds what the per-artist finder finds.
  const find = libraryReleaseFinder(libraryArtistFinder(library.artists), library.albums);
  let matched = 0;
  for (const song of someSongs(400)) {
    const credits = next.value.resolve(song);
    assert.deepEqual(credits, whole(song));
    if (song.album === null) continue;
    const album = find({ title: song.album, artists: credits.artists.map((a) => a.name) });
    assert.equal(credits.album?.id, album?.id ?? credits.album?.id);
    if (album !== null) matched++;
  }
  assert.ok(matched > 0);
});

test("a resolver that learns releases later resolves as one built with them", () => {
  const library = sizedLibrary(200);
  const [early, late] = [library.releases.slice(0, 20), library.releases.slice(20)];
  const learned = finishSteps(streamedCreditResolverSteps({ ...library, releases: early }));
  learned.learn(late);
  const whole = streamedCredits(library);
  for (const song of someSongs(200)) assert.deepEqual(learned.resolve(song), whole(song));
});
