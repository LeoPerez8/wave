import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { YtListHead } from "./routes.ts";
import { shownYtListHead } from "./ytListHead.ts";
import type { YtListLoad } from "./YtSongList.tsx";

const tapped: YtListHead = { title: "From the cover", line: "", artworkUrl: null };
const read: YtListHead = { title: "From YT Music", line: "Someone", artworkUrl: null };

const loaded = (rest: "reading" | "read" | "failed"): YtListLoad => ({
  status: "loaded",
  page: { head: read, kind: { type: "playlist" }, songs: [] },
  rest,
});

describe("shownYtListHead", () => {
  it("has no head to show while nothing is known of a page being read", () => {
    assert.equal(shownYtListHead({ status: "loading" }, undefined), undefined);
  });

  it("keeps what the tapped cover knew until the page arrives", () => {
    assert.equal(shownYtListHead({ status: "loading" }, tapped), tapped);
  });

  it("takes the page's own head from its first page on, with more pages coming", () => {
    assert.equal(shownYtListHead(loaded("reading"), tapped), read);
    assert.equal(shownYtListHead(loaded("reading"), undefined), read);
  });

  it("keeps the page's head when the rest of it couldn't be read", () => {
    assert.equal(shownYtListHead(loaded("failed"), tapped), read);
  });

  it("keeps what the cover knew on a page that couldn't be read at all", () => {
    assert.equal(shownYtListHead({ status: "quiet", reason: "offline" }, tapped), tapped);
    assert.equal(shownYtListHead({ status: "quiet", reason: "failed" }, undefined), undefined);
  });
});
