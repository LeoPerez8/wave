import assert from "node:assert/strict";
import test from "node:test";
import { keepYtList, keptYtList } from "./knownYtPages.ts";
import type { YtListLoad, YtListPage } from "./YtSongList.tsx";

const page = (title: string): YtListPage => ({
  head: { title, line: "Artist", artworkUrl: null },
  kind: { type: "album", year: null },
  songs: [],
});

test("an album read whole this session opens with its songs at once", () => {
  assert.equal(keptYtList("yt-album", "MPREb_one"), undefined);
  const loaded: YtListLoad = { status: "loaded", page: page("One"), rest: "read" };
  keepYtList("yt-album", "MPREb_one", loaded);
  assert.deepEqual(keptYtList("yt-album", "MPREb_one"), loaded);
  // Another screen with the same id is another page.
  assert.equal(keptYtList("yt-playlist", "MPREb_one"), undefined);
});

test("a playlist whose rest didn't come, or still reading, is read again next time", () => {
  keepYtList("yt-playlist", "PL_partial", { status: "loaded", page: page("P"), rest: "failed" });
  keepYtList("yt-playlist", "PL_reading", { status: "loaded", page: page("R"), rest: "reading" });
  keepYtList("yt-playlist", "PL_quiet", { status: "quiet", reason: "offline" });
  assert.equal(keptYtList("yt-playlist", "PL_partial"), undefined);
  assert.equal(keptYtList("yt-playlist", "PL_reading"), undefined);
  assert.equal(keptYtList("yt-playlist", "PL_quiet"), undefined);
});
