import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  UNKNOWN_ALBUM,
  missingSongJob,
  missingSongJobId,
  missingSongLookup,
  missingSongSearch,
  missingSongTags,
  recordingKey,
  missingSongVideo,
} from "./index.ts";
import type { MissingTrack, YtSong } from "./index.ts";

const track = (patch: Partial<MissingTrack> = {}): MissingTrack => ({
  id: 7,
  title: "Halo",
  artist: "Beyoncé",
  artists: ["Beyoncé"],
  album: "I Am... Sasha Fierce",
  albumArtist: "Beyoncé",
  year: 2008,
  trackNumber: 3,
  discNumber: 1,
  genre: "Pop",
  durationMs: 261_000,
  videoId: null,
  ...patch,
});

describe("missingSongJob", () => {
  test("a missing song's download job is named after its Track, never after a video", () => {
    assert.equal(missingSongJobId(7), "missing:7");
    assert.equal(missingSongJob(track()).videoId, "missing:7");
    assert.equal(missingSongJob(track({ videoId: "abc" })).videoId, "missing:7");
  });

  test("the job carries the song as its Track has it: title, artists, album and length", () => {
    const job = missingSongJob(track({ artists: ["Beyoncé", "Jay-Z"] }));
    assert.equal(job.title, "Halo");
    assert.deepEqual(job.artists, ["Beyoncé", "Jay-Z"]);
    assert.equal(job.album, "I Am... Sasha Fierce");
    assert.equal(job.durationMs, 261_000);
    assert.equal(job.missing.trackId, 7);
  });

  test("no album and no length are unknown, as a YT Music song says them", () => {
    const job = missingSongJob(track({ album: UNKNOWN_ALBUM, durationMs: 0 }));
    assert.equal(job.album, null);
    assert.equal(job.durationMs, null);
  });
});

const result = (videoId: string, patch: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title: "Halo",
  artists: ["Beyoncé"],
  album: "I Am... Sasha Fierce",
  durationMs: 261_000,
  artworkUrl: `https://i.ytimg.com/${videoId}`,
  explicit: false,
  ...patch,
});

describe("missingSongVideo", () => {
  test("a missing song with a video id downloads that video, with nothing searched", () => {
    const job = missingSongJob(track({ videoId: "abc" }));
    assert.equal(missingSongSearch(job), null);
    assert.deepEqual(missingSongVideo(job, null), { videoId: "abc", artworkUrl: null });
  });

  test("any other is searched on YouTube Music by its title and artists", () => {
    const job = missingSongJob(track({ artists: ["Beyoncé", "Jay-Z"] }));
    assert.equal(missingSongSearch(job), "Halo Beyoncé Jay-Z");
  });

  test("the first result that is the recording is downloaded, with its cover", () => {
    const job = missingSongJob(track());
    const found = missingSongVideo(job, [
      result("cover", { artists: ["Someone Else"] }),
      result("song"),
      result("again"),
    ]);
    assert.deepEqual(found, { videoId: "song", artworkUrl: "https://i.ytimg.com/song" });
  });

  test("another edition, or a length more than 3 seconds off, isn't the song", () => {
    const job = missingSongJob(track());
    assert.equal(missingSongVideo(job, [result("live", { title: "Halo (Live)" })]), null);
    assert.equal(missingSongVideo(job, [result("long", { durationMs: 265_000 })]), null);
    assert.deepEqual(
      missingSongVideo(job, [result("close", { durationMs: 263_000 })])?.videoId,
      "close",
    );
  });

  test("with nothing found, or no search made, there's no video", () => {
    const job = missingSongJob(track());
    assert.equal(missingSongVideo(job, []), null);
    assert.equal(missingSongVideo(job, null), null);
  });
});

describe("missingSongTags", () => {
  const found = {
    genre: "R&B",
    trackNumber: 9,
    discNumber: 2,
    year: 2009,
    lyrics: { synced: true, text: "[00:01.00] Remember" },
  };

  test("the file is tagged as the Track is, so it's the same recording for the Wave account", () => {
    const missing = track();
    const tags = missingSongTags(missingSongJob(missing), found, null);
    assert.equal(tags.title, "Halo");
    assert.equal(tags.artist, "Beyoncé");
    assert.equal(tags.album, "I Am... Sasha Fierce");
    assert.equal(tags.albumArtist, "Beyoncé");
    assert.deepEqual(
      [tags.year, tags.trackNumber, tags.discNumber, tags.genre],
      [2008, 3, 1, "Pop"],
    );
    assert.equal(recordingKey(tags), recordingKey(missing));
  });

  test("what the Track lacks comes from the lookup: lyrics, and a genre, year or number it has no tag for", () => {
    const tags = missingSongTags(
      missingSongJob(track({ genre: null, year: null, trackNumber: null, discNumber: null })),
      found,
      null,
    );
    assert.deepEqual(
      [tags.year, tags.trackNumber, tags.discNumber, tags.genre],
      [2009, 9, 2, "R&B"],
    );
    assert.equal(tags.lyrics, "[00:01.00] Remember");
  });

  test("a song without an album has none, and YouTube Music's cover is asked for large", () => {
    const tags = missingSongTags(
      missingSongJob(track({ album: UNKNOWN_ALBUM })),
      null,
      "https://lh3.googleusercontent.com/x=w120-h120-l90-rj",
    );
    assert.equal(tags.album, null);
    assert.equal(tags.artworkUrl, "https://lh3.googleusercontent.com/x=w1200-h1200-l90-rj");
    assert.equal(tags.lyrics, null);
  });

  test("lyrics and genre are looked up by the Track's title, artist, album and length", () => {
    assert.deepEqual(missingSongLookup(missingSongJob(track())), {
      title: "Halo",
      artist: "Beyoncé",
      album: "I Am... Sasha Fierce",
      durationMs: 261_000,
    });
  });
});
