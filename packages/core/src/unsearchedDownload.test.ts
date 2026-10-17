import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  downloadSource,
  isUnsearchedSongJob,
  playlistEntryLinks,
  settleUnsearched,
  unsearchedDownload,
  unsearchedJobSong,
  unsearchedSongJob,
  type UnsearchedSong,
  type YtAlbumSong,
  type YtSongSearch,
} from "./index.ts";

const touch: UnsearchedSong = {
  title: "Touch",
  artists: ["Daft Punk", "Paul Williams"],
  album: "Random Access Memories",
  durationMs: 498_000,
  artworkUrl: "https://i.scdn.co/image/ram",
};

const yt = (videoId: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title: "Touch (feat. Paul Williams)",
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  albumId: "MPREb_ram",
  durationMs: 499_000,
  artworkUrl: "https://lh3.googleusercontent.com/ram=w120-h120",
  explicit: false,
  ...fields,
});

describe("an unsearched song's download job", () => {
  test("it goes by what Spotify listed, and the job gives the song back with its cover", () => {
    const job = unsearchedSongJob(touch);
    assert.equal(
      job.videoId,
      'unsearched:["Touch",["Daft Punk","Paul Williams"],"Random Access Memories",498000]',
    );
    assert.ok(isUnsearchedSongJob(job.videoId));
    assert.ok(!isUnsearchedSongJob("dQw4w9WgXcQ"));
    assert.ok(!isUnsearchedSongJob("missing:12"));
    assert.deepEqual(unsearchedJobSong(job.videoId, job), touch);
    assert.equal(unsearchedJobSong("dQw4w9WgXcQ", job), null);
  });

  test("it has no video, so its source is a song's without one", () => {
    // Best quality on: Soulseek by its title and artists; off: YouTube Music's search.
    assert.equal(downloadSource({ ytMusicOn: true, bestQuality: true }), "soulseek");
    assert.equal(downloadSource({ ytMusicOn: true, bestQuality: false }), "youtube");
    assert.equal(downloadSource({ ytMusicOn: false, bestQuality: false }), null);
  });
});

describe("what the download's YouTube Music search does", () => {
  const download = (answer: YtSongSearch<YtAlbumSong>) =>
    unsearchedDownload(touch, settleUnsearched(touch, answer));

  test("found: the entry becomes the YT Music song, and its video downloads with what Spotify listed", () => {
    const found = yt("touchAtv");
    const step = download({ ok: true, songs: [yt("touchLive", { title: "Touch (Live)" }), found] });
    assert.deepEqual(step, {
      kind: "download",
      found,
      // The search lists audio tracks: its video is the album cut, with no second search.
      video: "touchAtv",
      // Tagged from what the entry kept, and the album page the video is filed under.
      song: {
        videoId: "touchAtv",
        title: "Touch",
        artists: ["Daft Punk", "Paul Williams"],
        album: "Random Access Memories",
        albumId: "MPREb_ram",
        durationMs: 498_000,
        artworkUrl: "https://i.scdn.co/image/ram",
        explicit: false,
      },
    });
  });

  test("not found: the entry is unavailable and the row fails with why", () => {
    assert.deepEqual(download({ ok: true, songs: [yt("other", { title: "Lose Yourself" })] }), {
      kind: "fail",
      failure: "notFound",
    });
  });

  test("a failed search leaves the entry unsearched and fails the row", () => {
    assert.deepEqual(download({ ok: false, reason: "offline" }), {
      kind: "fail",
      failure: "offline",
    });
    assert.deepEqual(download({ ok: false, reason: "failed" }), {
      kind: "fail",
      failure: "failed",
    });
    assert.deepEqual(download({ ok: false, reason: "disabled" }), {
      kind: "fail",
      failure: "noSource",
    });
  });

  test("once the file lands, the entry becomes the Library's song in its place, found or still unsearched", () => {
    const track = {
      id: 7,
      title: "Touch",
      artist: "Daft Punk, Paul Williams",
      durationMs: 498_400,
    };
    const entries = [
      // Found by the download's search: a YT Music entry now.
      { itemId: 1, playlistId: 10, song: yt("touchAtv") },
      // Downloaded from Soulseek: nothing searched it.
      { itemId: 2, playlistId: 11, song: touch },
    ];
    assert.deepEqual(playlistEntryLinks(entries, [track], []), {
      links: [
        { itemId: 1, trackId: 7 },
        { itemId: 2, trackId: 7 },
      ],
      drops: [],
    });
  });
});
