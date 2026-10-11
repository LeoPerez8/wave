import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeFolder,
  filesLeavingWithRoot,
  isWithin,
  planAddRoot,
  type ScanRootState,
} from "./index.ts";

const STORAGE = "/storage/emulated/0";
const MUSIC = `${STORAGE}/Music`;

const root = (path: string, trackCount = 0, isDefault = false): ScanRootState => ({
  path,
  isDefault,
  trackCount,
});

describe("isWithin", () => {
  test("a folder contains itself and its descendants", () => {
    assert.ok(isWithin(MUSIC, MUSIC));
    assert.ok(isWithin(`${MUSIC}/Rock/a.mp3`, MUSIC));
  });

  test("a sibling sharing a name prefix is not inside", () => {
    assert.ok(!isWithin(`${STORAGE}/Music2/a.mp3`, MUSIC));
  });
});

describe("planAddRoot", () => {
  test("the first pick replaces a default Music root that found nothing", () => {
    const plan = planAddRoot([root(MUSIC, 0, true)], `${STORAGE}/Músicas`);
    assert.deepEqual(plan, { kind: "add", drop: [MUSIC] });
  });

  test("a default Music root that has music is kept", () => {
    const plan = planAddRoot([root(MUSIC, 12, true)], `${STORAGE}/Músicas`);
    assert.deepEqual(plan, { kind: "add", drop: [] });
  });

  test("an empty root the owner picked is kept", () => {
    const plan = planAddRoot([root(MUSIC, 0)], `${STORAGE}/Músicas`);
    assert.deepEqual(plan, { kind: "add", drop: [] });
  });

  test("a folder inside an existing root adds nothing", () => {
    const plan = planAddRoot([root(MUSIC, 3)], `${MUSIC}/Rock`);
    assert.deepEqual(plan, { kind: "covered", by: MUSIC });
  });

  test("picking an existing root again adds nothing", () => {
    assert.deepEqual(planAddRoot([root(MUSIC, 3)], MUSIC), { kind: "covered", by: MUSIC });
  });

  test("a parent folder replaces the roots inside it", () => {
    const plan = planAddRoot(
      [root(MUSIC, 3), root(`${STORAGE}/Podcasts`, 1), root("/storage/1A2B-3C4D/Music", 2)],
      STORAGE,
    );
    assert.deepEqual(plan, { kind: "add", drop: [MUSIC, `${STORAGE}/Podcasts`] });
  });
});

describe("filesLeavingWithRoot", () => {
  test("files under the removed root leave unless another root covers them", () => {
    const files = [`${MUSIC}/a.mp3`, `${MUSIC}/Live/b.mp3`, `${STORAGE}/Músicas/c.mp3`];
    assert.deepEqual(filesLeavingWithRoot(files, MUSIC, [`${STORAGE}/Músicas`]), [
      `${MUSIC}/a.mp3`,
      `${MUSIC}/Live/b.mp3`,
    ]);
    assert.deepEqual(filesLeavingWithRoot(files, MUSIC, [`${MUSIC}/Live`]), [`${MUSIC}/a.mp3`]);
  });
});

describe("describeFolder", () => {
  test("a folder on internal storage", () => {
    assert.deepEqual(describeFolder(`${STORAGE}/Músicas`), {
      name: "Músicas",
      storage: "Internal storage",
      relativePath: "Músicas",
    });
  });

  test("a nested folder on an SD card", () => {
    assert.deepEqual(describeFolder("/storage/1A2B-3C4D/Media/Music"), {
      name: "Music",
      storage: "SD card",
      relativePath: "Media/Music",
    });
  });

  test("the storage root itself is named after the storage", () => {
    assert.deepEqual(describeFolder(STORAGE), {
      name: "Internal storage",
      storage: "Internal storage",
      relativePath: "",
    });
  });

  test("a path outside shared storage keeps its full path", () => {
    assert.deepEqual(describeFolder("/data/music"), {
      name: "music",
      storage: null,
      relativePath: "/data/music",
    });
  });
});
