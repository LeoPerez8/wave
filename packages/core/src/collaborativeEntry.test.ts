import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  collaborativeEntryMatcher,
  libraryEntryFields,
  type CollaborativeEntryMatch,
  type EntryTrack,
  type LibraryEntryFields,
} from "./index.ts";

const track = (id: number, more: Partial<EntryTrack> = {}): EntryTrack & { id: number } => ({
  id,
  recordingKey: `key-${id}`,
  title: "Airbag",
  artist: "Radiohead",
  album: "OK Computer",
  durationMs: 284_000,
  videoId: null,
  ...more,
});

const fields = (more: Partial<LibraryEntryFields> = {}): LibraryEntryFields => ({
  title: "Airbag",
  credit: "Radiohead",
  album: "OK Computer",
  durationMs: 284_000,
  videoId: null,
  ...more,
});

const matchedId = (
  match: CollaborativeEntryMatch<EntryTrack & { id: number }> | null,
): number | string | null =>
  match === null ? null : match.source === "library" ? match.track.id : match.source;

describe("matching a collaborative entry to a Track", () => {
  test("the recording key comes first", () => {
    const match = collaborativeEntryMatcher([
      track(1, { title: "Other", recordingKey: "key-x" }),
      track(2, { recordingKey: "key-airbag" }),
    ]);
    assert.equal(matchedId(match({ songId: "key-x", ...fields() })), 1);
  });

  test("then the video id", () => {
    const match = collaborativeEntryMatcher([
      track(1, { title: "Airbag" }),
      track(2, { title: "Airbag (Live)", videoId: "vid-1" }),
    ]);
    assert.equal(matchedId(match({ songId: "key-other", ...fields({ videoId: "vid-1" }) })), 2);
  });

  test("unmatched with a video id, it is a YT Music entry of that song", () => {
    const match = collaborativeEntryMatcher([track(1, { title: "Lucky" })]);
    assert.deepEqual(match({ songId: "key-other", ...fields({ videoId: "vid-1" }) }), {
      source: "stream",
      song: {
        videoId: "vid-1",
        title: "Airbag",
        artists: ["Radiohead"],
        album: "OK Computer",
        durationMs: 284_000,
        artworkUrl: "https://i.ytimg.com/vi/vid-1/hqdefault.jpg",
        explicit: false,
      },
    });
  });

  test("unmatched without a video id, it is an unsearched entry", () => {
    const match = collaborativeEntryMatcher([track(1, { title: "Lucky" })]);
    assert.deepEqual(match({ songId: "key-other", ...fields() }), {
      source: "unsearched",
      song: {
        title: "Airbag",
        artists: ["Radiohead"],
        album: "OK Computer",
        durationMs: 284_000,
        artworkUrl: null,
      },
    });
  });

  test("then a matching title, a shared artist and a length within 3 seconds", () => {
    const match = collaborativeEntryMatcher([
      track(1, { title: "Lucky" }),
      track(2, {
        title: "Airbag (Remastered)",
        artist: "Radiohead feat. Someone",
        durationMs: 286_500,
      }),
    ]);
    assert.equal(matchedId(match({ songId: "key-other", ...fields() })), 2);
  });

  test("a length more than 3 seconds off is another recording", () => {
    const match = collaborativeEntryMatcher([track(1, { durationMs: 288_000 })]);
    assert.equal(matchedId(match({ songId: "key-other", ...fields() })), "unsearched");
  });

  test("without a known length on both, the tags match nothing", () => {
    const tracks = [track(1, { durationMs: 0 })];
    assert.equal(
      matchedId(collaborativeEntryMatcher(tracks)({ songId: "key-other", ...fields() })),
      "unsearched",
    );
    assert.equal(
      matchedId(
        collaborativeEntryMatcher([track(1)])({ songId: "k", ...fields({ durationMs: null }) }),
      ),
      "unsearched",
    );
  });

  test("when several Tracks fit, the album breaks the tie", () => {
    const match = collaborativeEntryMatcher([
      track(1, { album: "Greatest Hits" }),
      track(2, { album: "OK Computer" }),
    ]);
    assert.equal(matchedId(match({ songId: "key-other", ...fields({ album: "ok computer" }) })), 2);
  });

  test("the album breaks a tie of one video id too", () => {
    const match = collaborativeEntryMatcher([
      track(1, { album: "Greatest Hits", videoId: "vid-1" }),
      track(2, { album: "OK Computer", videoId: "vid-1" }),
    ]);
    assert.equal(matchedId(match({ songId: "key-other", ...fields({ videoId: "vid-1" }) })), 2);
  });

  test("when more than one Track still fits, the entry is not matched", () => {
    const twoOnAlbum = collaborativeEntryMatcher([track(1), track(2)]);
    assert.equal(matchedId(twoOnAlbum({ songId: "key-other", ...fields() })), "unsearched");
    const noAlbum = collaborativeEntryMatcher([
      track(1, { album: "Greatest Hits" }),
      track(2, { album: "OK Computer" }),
    ]);
    assert.equal(matchedId(noAlbum({ songId: "k", ...fields({ album: null }) })), "unsearched");
    const otherAlbum = collaborativeEntryMatcher([
      track(1, { album: "Greatest Hits" }),
      track(2, { album: "Live" }),
    ]);
    assert.equal(matchedId(otherAlbum({ songId: "k", ...fields({ videoId: "vid-9" }) })), "stream");
  });

  test("a step that finds Tracks it can't tell apart decides: later steps don't guess", () => {
    const match = collaborativeEntryMatcher([
      track(1, { recordingKey: "key-a", album: "Greatest Hits", videoId: "vid-1" }),
      track(2, { recordingKey: "key-a", album: "Live" }),
    ]);
    assert.equal(matchedId(match({ songId: "key-a", ...fields({ videoId: "vid-1" }) })), "stream");
  });

  test("an entry with nothing but a recording key that matches nothing shows nothing", () => {
    const match = collaborativeEntryMatcher([track(1)]);
    const bare = {
      songId: "key-other",
      title: null,
      credit: null,
      album: null,
      durationMs: null,
      videoId: null,
    };
    assert.equal(match(bare), null);
    assert.equal(matchedId(match({ ...bare, songId: "key-1" })), 1);
  });
});

describe("a Library song's entry fields", () => {
  test("are the Track's title, artist credit, album, length and video id", () => {
    assert.deepEqual(
      libraryEntryFields(track(1, { artist: "Radiohead feat. X", videoId: "vid-1" })),
      {
        title: "Airbag",
        credit: "Radiohead feat. X",
        album: "OK Computer",
        durationMs: 284_000,
        videoId: "vid-1",
      },
    );
  });

  test("leave out what the file doesn't say", () => {
    assert.deepEqual(
      libraryEntryFields(track(1, { artist: UNKNOWN_ARTIST, album: UNKNOWN_ALBUM, durationMs: 0 })),
      { title: "Airbag", credit: null, album: null, durationMs: null, videoId: null },
    );
  });

  test("match the Track they came from on another device with another recording key", () => {
    const mine = track(1, { videoId: "vid-1" });
    const theirs = track(7, { recordingKey: "their-key", durationMs: 285_000 });
    const match = collaborativeEntryMatcher([track(6, { title: "Lucky" }), theirs]);
    assert.equal(matchedId(match({ songId: mine.recordingKey, ...libraryEntryFields(mine) })), 7);
  });
});
