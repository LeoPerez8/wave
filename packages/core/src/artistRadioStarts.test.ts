import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_ARTIST_RADIO_STARTS,
  artistRadioStart,
  parseArtistRadioStarts,
  storedArtistRadioStarts,
  withArtistRadioStart,
} from "./index.ts";

const start = (n: number) => ({ playlistId: `RDEM${n}`, params: `p${n}` });

describe("Remembered artist radio starts", () => {
  test("an artist page's radio start is remembered by its browse id", () => {
    const starts = withArtistRadioStart(NO_ARTIST_RADIO_STARTS, "UC1", start(1));
    assert.deepEqual(artistRadioStart(starts, "UC1"), start(1));
    assert.equal(artistRadioStart(starts, "UC2"), null);
  });

  test("a start YouTube Music refused is forgotten", () => {
    const starts = withArtistRadioStart(NO_ARTIST_RADIO_STARTS, "UC1", start(1));
    assert.equal(artistRadioStart(withArtistRadioStart(starts, "UC1", null), "UC1"), null);
  });

  test("keeps the 500 artists whose radio started last", () => {
    let starts = NO_ARTIST_RADIO_STARTS;
    for (let n = 0; n < 500; n += 1) starts = withArtistRadioStart(starts, `UC${n}`, start(n));
    starts = withArtistRadioStart(starts, "UC0", start(0));
    starts = withArtistRadioStart(starts, "UC500", start(500));
    assert.deepEqual(artistRadioStart(starts, "UC0"), start(0));
    assert.equal(artistRadioStart(starts, "UC1"), null);
    assert.deepEqual(artistRadioStart(starts, "UC500"), start(500));
  });

  test("are kept on the phone and read back, a start without params too", () => {
    const starts = withArtistRadioStart(
      withArtistRadioStart(NO_ARTIST_RADIO_STARTS, "UC1", start(1)),
      "UC2",
      { playlistId: "RDEM2", params: null },
    );
    const read = parseArtistRadioStarts(storedArtistRadioStarts(starts));
    assert.deepEqual(artistRadioStart(read, "UC1"), start(1));
    assert.deepEqual(artistRadioStart(read, "UC2"), { playlistId: "RDEM2", params: null });
  });

  test("nothing readable saved reads as none", () => {
    for (const stored of [null, "{", '{"version":9,"starts":[]}', '{"version":1,"starts":[[1]]}'])
      assert.equal(parseArtistRadioStarts(stored).size, 0);
    assert.equal(storedArtistRadioStarts(NO_ARTIST_RADIO_STARTS), null);
  });
});
