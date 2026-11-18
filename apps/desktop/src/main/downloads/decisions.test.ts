import assert from "node:assert/strict";
import { test } from "node:test";
import type { MissingTrack, YtDownloadTags, YtSong } from "@wave/core";
import { createAnswers, type AnswerDeps, type DownloadClaim } from "./decisions.ts";

const song: YtSong = {
  videoId: "abcdefghijk",
  title: "Águas de Março",
  artists: ["Elis Regina", "Tom Jobim"],
  album: "Elis & Tom",
  durationMs: 212_000,
  artworkUrl: "https://lh3.googleusercontent.com/cover=w120-h120",
  explicit: false,
  videoType: "MUSIC_VIDEO_TYPE_ATV",
};

const track: MissingTrack = {
  id: 42,
  title: "Chega de Saudade",
  artist: "João Gilberto",
  artists: ["João Gilberto"],
  album: "Chega de Saudade",
  albumArtist: "João Gilberto",
  year: 1959,
  trackNumber: 1,
  discNumber: null,
  genre: "Bossa Nova",
  durationMs: 120_000,
  videoId: "zyxwvutsrqp",
  releaseDate: null,
};

/** What the tests read of an answer. */
interface Answer {
  readonly source?: string;
  readonly video?: string;
  readonly targetPath?: string;
  readonly candidates: readonly unknown[];
  readonly tags: YtDownloadTags;
  readonly fallback: { readonly source: string; readonly targetPath: string };
  readonly failure?: string;
  readonly failurePlan?: unknown;
  readonly acceptable?: boolean;
  readonly cause: string;
}

const imported: { path: string; videoId: string | null; fills: number | null }[] = [];
const deps = (change: Partial<AnswerDeps> = {}): AnswerDeps => ({
  policy: async () => ({
    roots: [{ path: "C:/Music", isDefault: true }],
    excludedFolders: [],
    revision: 7,
  }),
  ytMusicOn: () => true,
  session: async () => ({ status: "off", username: null }),
  soulseekSearch: async () => [],
  watchSong: async () => ({ albumId: "MPREb_album", lyricsBrowseId: null }),
  album: async () => ({
    title: "Elis & Tom",
    artists: ["Elis Regina", "Tom Jobim"],
    year: 1974,
    artworkUrl: "https://lh3.googleusercontent.com/album=w120-h120",
    tracks: [],
  }),
  ytLyrics: async () => null,
  ytSearch: async () => [],
  lookUp: async () => ({
    lyrics: { synced: false, text: "É pau, é pedra" },
    genre: "MPB",
    trackNumber: 1,
    discNumber: 1,
    year: 1974,
    explicit: "clean",
  }),
  missingSongs: (ids) => (ids.includes(42) ? [track] : []),
  importFile: async (path, made) => {
    imported.push({ path, ...made });
  },
  ...change,
});

const claim = (fields: Partial<DownloadClaim>): DownloadClaim => ({
  id: song.videoId,
  song,
  generation: 1,
  token: "t",
  decision: "prepare",
  phase: "preparing",
  ...fields,
});

test("a YT Music song is prepared from YouTube, tagged from its album page and the lookups", async () => {
  const answer = (await createAnswers(deps()).answer(claim({}))) as Answer;
  assert.equal(answer["source"], "youtube");
  assert.equal(answer["targetPath"], "C:/Music/Elis Regina & Tom Jobim/Elis & Tom/01 Águas de Março.m4a");
  assert.equal(answer["tags"].album, "Elis & Tom");
  assert.equal(answer["tags"].year, 1974);
  assert.equal(answer["tags"].genre, "MPB");
  assert.equal(answer["tags"].lyrics, "É pau, é pedra");
  assert.deepEqual(answer["candidates"], []);
});

test("Download in best quality searches Soulseek and keeps YouTube Music as the fallback", async () => {
  const peer = {
    username: "peer",
    filename: "Elis Regina - Águas de Março.mp3",
    bytes: 8_000_000,
    bitrateKbps: 320,
    durationMs: 212_000,
    freeSlot: true,
    uploadSpeed: 1_000_000,
    queueLength: 0,
  };
  const answer = (await createAnswers(
    deps({
      session: async () => ({ status: "connected", username: "me" }),
      soulseekSearch: async () => [peer],
    }),
  ).answer(claim({}))) as Answer;
  assert.equal(answer["source"], "soulseek");
  assert.equal(answer["candidates"].length, 1);
  assert.ok(String(answer["targetPath"]).endsWith(".mp3"));
  assert.equal(answer["fallback"].source, "youtube");
  assert.ok(String(answer["fallback"].targetPath).endsWith(".m4a"));
});

test("a missing song with its own video downloads that video with its Track's tags", async () => {
  const answer = (await createAnswers(deps()).answer(
    claim({ id: "missing:42", song: { ...song, videoId: "missing:42" } }),
  )) as Answer;
  assert.equal(answer["source"], "youtube");
  assert.equal(answer["video"], "zyxwvutsrqp");
  assert.equal(answer["tags"].title, "Chega de Saudade");
  assert.equal(answer["tags"].genre, "Bossa Nova");
  assert.equal(answer["tags"].year, 1959);
});

test("no folder to download into fails the prepare with its plan", async () => {
  const answer = (await createAnswers(
    deps({ policy: async () => ({ roots: [], excludedFolders: [], revision: 1 }) }),
  ).answer(claim({}))) as Answer;
  assert.equal(answer["failure"], "noFolder");
  assert.ok(answer["failurePlan"] !== undefined);
});

test("YouTube audio of another length is turned down; the song's length is accepted", async () => {
  const answers = createAnswers(deps());
  const audio = { partPath: "x.part", bytes: 1, mimeType: "audio/mp4", itag: 140, bitrate: 128_000 };
  assert.deepEqual(
    await answers.answer(
      claim({ decision: "confirm", receiptId: "r", audio: { ...audio, durationMs: 212_500 } }),
    ),
    { receiptId: "r", acceptable: true },
  );
  const wrong = (await answers.answer(
    claim({ decision: "confirm", receiptId: "r", audio: { ...audio, durationMs: 300_000 } }),
  )) as Answer;
  assert.equal(wrong["acceptable"], false);
  assert.match(wrong["cause"], /long/);
});

test("publish names the place in the Library's folders at the policy's revision", async () => {
  const answer = await createAnswers(deps()).answer(
    claim({
      decision: "publish",
      source: "youtube",
      tags: {
        title: "Águas de Março",
        artist: "Elis Regina",
        album: "Elis & Tom",
        albumArtist: "Elis Regina",
        year: 1974,
        trackNumber: 1,
        discNumber: null,
        genre: null,
        lyrics: null,
        artworkUrl: null,
        advisory: null,
      },
    }),
  );
  assert.deepEqual(answer, {
    targetPath: "C:/Music/Elis Regina/Elis & Tom/01 Águas de Março.m4a",
    revision: 7,
  });
});

test("import puts the file in the Library with its video, and a missing song fills its Track", async () => {
  imported.length = 0;
  const answers = createAnswers(deps());
  const path = "C:/Music/x.m4a";
  assert.deepEqual(
    await answers.answer(claim({ decision: "import", source: "youtube", saved: { path } })),
    { path },
  );
  await answers.answer(
    claim({
      id: "missing:42",
      song: { ...song, videoId: "missing:42" },
      decision: "import",
      source: "youtube",
      video: "zyxwvutsrqp",
      saved: { path },
    }),
  );
  assert.deepEqual(imported, [
    { path, videoId: "abcdefghijk", fills: null },
    { path, videoId: "zyxwvutsrqp", fills: 42 },
  ]);
});
