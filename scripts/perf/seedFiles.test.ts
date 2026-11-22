import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { referenceCatalogue } from "../../packages/client/src/db/referenceSeed.ts";
import { mp3File, mp3DurationMs } from "./seedFiles.ts";

const song = {
  title: "Falling Home",
  artist: "Amber Ashby",
  album: "Silver Rivers",
  genre: "Rock",
  year: 1997,
  trackNumber: 2,
  frames: 7_000,
};

/** The text frames of an ID3v2.3 tag at the start of [bytes], and where the tag ends. */
const readId3 = (bytes: Uint8Array): { frames: Map<string, string>; end: number } => {
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 3)), "ID3");
  assert.equal(bytes[3], 3);
  const size = (bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!;
  const frames = new Map<string, string>();
  let at = 10;
  while (at < 10 + size && bytes[at] !== 0) {
    const id = new TextDecoder().decode(bytes.subarray(at, at + 4));
    const length = new DataView(bytes.buffer, bytes.byteOffset + at + 4, 4).getUint32(0);
    assert.equal(bytes[at + 10], 0, `${id} is ISO-8859-1`);
    frames.set(id, new TextDecoder("latin1").decode(bytes.subarray(at + 11, at + 10 + length)));
    at += 10 + length;
  }
  return { frames, end: 10 + size };
};

describe("mp3File", () => {
  it("tags the file with the song's title, artists, album, genre, year and number", () => {
    const { frames } = readId3(mp3File(song));
    assert.deepEqual(Object.fromEntries(frames), {
      TIT2: "Falling Home",
      TPE1: "Amber Ashby",
      TPE2: "Amber Ashby",
      TALB: "Silver Rivers",
      TCON: "Rock",
      TYER: "1997",
      TRCK: "2",
    });
  });

  it("starts its audio with a Xing header that counts the song's frames", () => {
    const bytes = mp3File(song);
    const { end } = readId3(bytes);
    // MPEG-1 Layer III, 32 kbps, 44.1 kHz, mono, no CRC.
    assert.deepEqual([...bytes.subarray(end, end + 4)], [0xff, 0xfb, 0x10, 0xc0]);
    assert.equal(new TextDecoder().decode(bytes.subarray(end + 21, end + 25)), "Xing");
    const view = new DataView(bytes.buffer, bytes.byteOffset + end + 25);
    assert.equal(view.getUint32(0) & 1, 1);
    assert.equal(view.getUint32(4), song.frames);
    // More frames follow, so a reader finds the stream's sync again.
    assert.deepEqual([...bytes.subarray(end + 104, end + 108)], [0xff, 0xfb, 0x10, 0xc0]);
    assert.equal((bytes.length - end) % 104, 0);
  });

  it("stays small whatever the song's length", () => {
    assert.ok(mp3File(song).length < 2_000);
  });
});

describe("mp3DurationMs", () => {
  it("is the length the seeded database gives each song", () => {
    for (const each of referenceCatalogue().songs.slice(0, 200))
      assert.equal(mp3DurationMs(each.frames), each.durationMs, each.file);
  });
});
