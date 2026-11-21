import assert from "node:assert/strict";
import { test } from "node:test";
import {
  openedAudioFiles,
  openedFilePath,
  openedFileTitle,
  openedFileTrackId,
  openedFilesQueue,
  parseTrackId,
} from "./index.ts";

const EXTENSIONS = ["mp3", "flac", "m4a"];

test("a launch's audio files are kept in order, and everything else is ignored", () => {
  assert.deepEqual(
    openedAudioFiles(
      [
        "C:\\Program Files\\Wave\\Wave.exe",
        "--hidden",
        "D:\\Music\\One.MP3",
        "D:\\Notes\\list.txt",
        "D:\\Music\\folder.flac\\",
        "",
        "D:\\Music\\Two.flac",
        "--lang=pt-BR",
        "D:\\Music\\no extension",
        "D:\\Music\\.mp3",
      ],
      EXTENSIONS,
    ),
    ["D:\\Music\\One.MP3", "D:\\Music\\Two.flac"],
  );
  assert.deepEqual(openedAudioFiles(["/usr/bin/wave", "/home/me/a.b/song.m4a"], EXTENSIONS), [
    "/home/me/a.b/song.m4a",
  ]);
  assert.deepEqual(openedAudioFiles(["/home/me/song.mp3.part", "-song.mp3"], EXTENSIONS), []);
});

test("a file in the Library queues as its song, another as the file itself", () => {
  const library = new Map([["/music/in.flac", 12]]);
  assert.deepEqual(
    openedFilesQueue(["/tmp/out.mp3", "/music/in.flac"], (path) => library.get(path) ?? null),
    ["file:/tmp/out.mp3", "12"],
  );
});

test("a file outside the Library has a queue id of its own", () => {
  const id = openedFileTrackId("C:/Users/me/Downloads/yt:song.mp3");
  assert.equal(openedFilePath(id), "C:/Users/me/Downloads/yt:song.mp3");
  assert.equal(openedFilePath("12"), null);
  assert.equal(openedFilePath("yt:abc"), null);
  assert.equal(openedFilePath("file:"), null);
  // Neither a Library song nor a YT Music one: nothing counts or syncs it.
  assert.equal(parseTrackId(id), null);
});

test("a file outside the Library goes by its name until its tags are read", () => {
  assert.equal(openedFileTitle("D:\\Music\\01 - Intro.final.mp3"), "01 - Intro.final");
  assert.equal(openedFileTitle("/home/me/song.flac"), "song");
  assert.equal(openedFileTitle("/home/me/.hidden"), ".hidden");
});
