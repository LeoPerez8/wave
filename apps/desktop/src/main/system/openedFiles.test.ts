import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createOpenedFiles, launchFiles } from "./openedFiles.ts";

test("a launch's files are its audio arguments, as absolute paths", () => {
  const cwd = resolve("music");
  assert.deepEqual(
    launchFiles(
      ["Wave.exe", "--hidden", "album/One.mp3", join(cwd, "Two.FLAC"), "cover.jpg", "--lang=en-US"],
      cwd,
    ),
    [join(cwd, "album", "One.mp3"), join(cwd, "Two.FLAC")],
  );
  assert.deepEqual(launchFiles(["Wave.exe", "."], cwd), []);
  // A Linux desktop entry's %U hands a file over as a file: address.
  assert.deepEqual(
    launchFiles(
      ["wave", pathToFileURL(join(cwd, "Três Um.mp3")).href, "file://%zz/broken.mp3"],
      "/",
    ),
    [join(cwd, "Três Um.mp3")],
  );
});

/** An inbox whose wait the test ends by hand, recording what it played. */
const inbox = () => {
  const played: string[][] = [];
  const timers = new Set<() => void>();
  const files = createOpenedFiles({
    play: (paths) => void played.push([...paths]),
    quietMs: 300,
    after: (_ms, run) => {
      timers.add(run);
      return () => void timers.delete(run);
    },
  });
  return {
    files,
    played,
    waiting: () => timers.size,
    quiet: () => {
      for (const run of timers) {
        timers.delete(run);
        run();
      }
    },
  };
};

test("files that arrive one launch each play together, in the order they came", () => {
  const { files, played, quiet, waiting } = inbox();
  files.ready();
  files.opened(["/music/One.mp3"]);
  files.opened(["/music/Two.mp3"]);
  files.opened([]);
  assert.deepEqual(played, [], "more may still come");
  assert.equal(waiting(), 1, "each arrival starts the wait again");
  quiet();
  assert.deepEqual(played, [["/music/One.mp3", "/music/Two.mp3"]]);
  files.opened(["/music/Three.mp3"]);
  quiet();
  assert.deepEqual(played.at(-1), ["/music/Three.mp3"]);
});

test("files opened while Wave starts wait for its services", () => {
  const { files, played, quiet, waiting } = inbox();
  files.opened(["/music/One.mp3"]);
  quiet();
  files.opened(["/music/Two.mp3"]);
  quiet();
  assert.deepEqual(played, []);
  files.ready();
  assert.equal(waiting(), 1);
  quiet();
  assert.deepEqual(played, [["/music/One.mp3", "/music/Two.mp3"]]);
});

test("a launch with no file plays nothing", () => {
  const { files, played, quiet, waiting } = inbox();
  files.ready();
  files.opened([]);
  assert.equal(waiting(), 0);
  quiet();
  assert.deepEqual(played, []);
});
