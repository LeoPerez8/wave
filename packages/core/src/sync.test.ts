import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { findRecording, normalizeTrack, recordingKey } from "./index.ts";
import type { RawTrack } from "./index.ts";

const MUSIC = "/storage/emulated/0/Music";

const something: RawTrack = {
  path: `${MUSIC}/The Beatles/Abbey Road/02 Something.flac`,
  title: "Something",
  artist: "The Beatles",
  album: "Abbey Road",
  albumArtist: "The Beatles",
  trackNumber: "2/17",
  discNumber: "1/1",
  durationMs: 182_000,
};

const keyOf = (raw: RawTrack): string => recordingKey(normalizeTrack(raw));

describe("recordingKey", () => {
  test("a re-download from another source is the same recording", () => {
    const redownload: RawTrack = {
      path: `${MUSIC}/Downloads/beatles_something_320.mp3`,
      title: "something!",
      artist: "The Beatles",
      album: "abbey  road",
      albumArtist: "the beatles",
      trackNumber: "2",
      discNumber: "1",
      durationMs: 183_500,
    };
    assert.equal(keyOf(redownload), keyOf(something));
  });

  test("the album version and the single are different recordings", () => {
    const single: RawTrack = {
      ...something,
      path: `${MUSIC}/The Beatles/Something/01 Something.mp3`,
      album: "Something",
      trackNumber: "1",
    };
    assert.notEqual(keyOf(single), keyOf(something));
  });

  test("a file without a disc number is on disc 1", () => {
    assert.equal(keyOf({ ...something, discNumber: null }), keyOf(something));
    assert.notEqual(keyOf({ ...something, discNumber: "2" }), keyOf(something));
  });

  test("a file without a track number keys on its album and title", () => {
    const untracked = { ...something, trackNumber: null, discNumber: null };
    assert.equal(keyOf({ ...untracked, path: `${MUSIC}/other.ogg` }), keyOf(untracked));
    assert.notEqual(keyOf(untracked), keyOf({ ...untracked, title: "Come Together" }));
  });

  test("a song with no album tag keys on its album artist and title", () => {
    const loose: RawTrack = {
      path: `${MUSIC}/Downloads/Something.mp3`,
      title: "Something",
      artist: "The Beatles",
      trackNumber: "4",
    };
    const elsewhere: RawTrack = {
      path: `${MUSIC}/Phone/the beatles - something.m4a`,
      title: "Something",
      artist: "the Beatles",
    };
    assert.equal(keyOf(elsewhere), keyOf(loose));
    assert.notEqual(keyOf(loose), keyOf({ ...loose, artist: "Shirley Bassey" }));
    assert.notEqual(keyOf(loose), keyOf(something));
    assert.equal(
      recordingKey({
        title: "Something",
        album: null,
        albumArtist: "The Beatles",
        discNumber: null,
        trackNumber: null,
      }),
      keyOf(loose),
    );
  });
});

describe("findRecording", () => {
  const song = { recordingKey: "k", durationMs: 200_000 };
  const take = (durationMs: number, key = "k") => ({ recordingKey: key, durationMs });

  test("the one candidate with the song's key is the song, whatever its length", () => {
    const only = take(260_000);
    assert.equal(findRecording(song, [take(200_000, "other"), only]), only);
  });

  test("no candidate with the song's key is no match", () => {
    assert.equal(findRecording(song, [take(200_000, "other")]), null);
  });

  test("among several with the key, the one within 3 seconds wins", () => {
    const close = take(202_900);
    assert.equal(findRecording(song, [take(240_000), close, take(196_000)]), close);
  });

  test("among several with the key, two within 3 seconds leave no winner", () => {
    assert.equal(findRecording(song, [take(198_000), take(203_000), take(260_000)]), null);
  });

  test("among several with the key, none within 3 seconds leaves no winner", () => {
    assert.equal(findRecording(song, [take(230_000), take(170_000)]), null);
  });
});
