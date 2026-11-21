import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  nowPlayingEditHintDue,
  readNowPlayingEditHintShown,
  storedNowPlayingEditHintShown,
} from "./index.ts";

describe("Now Playing's edit hint", () => {
  test("is due the first time Now Playing opens on a phone, a fresh install included", () => {
    const shown = readNowPlayingEditHintShown(null);
    assert.equal(nowPlayingEditHintDue({ nowPlayingOpen: true, shown }), true);
  });

  test("waits for Now Playing to open", () => {
    assert.equal(nowPlayingEditHintDue({ nowPlayingOpen: false, shown: false }), false);
  });

  test("isn't due again once it showed", () => {
    const shown = readNowPlayingEditHintShown(storedNowPlayingEditHintShown(true));
    assert.equal(nowPlayingEditHintDue({ nowPlayingOpen: true, shown }), false);
  });

  test("a phone that never showed it stores nothing", () => {
    assert.equal(storedNowPlayingEditHintShown(false), null);
  });

  test("a stored value Wave didn't write reads as not shown", () => {
    assert.equal(readNowPlayingEditHintShown("yes"), false);
    assert.equal(readNowPlayingEditHintShown(""), false);
  });
});
