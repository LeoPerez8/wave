import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { trackRowTrailing } from "./index.ts";

describe("trackRowTrailing", () => {
  test("a row on a ranking by plays shows its counted plays instead of the length", () => {
    assert.equal(trackRowTrailing({ durationMs: 187_000, countedPlays: 12 }), "12 plays");
    assert.equal(trackRowTrailing({ durationMs: 187_000, countedPlays: 1 }), "1 play");
  });

  test("any other list shows the song's length", () => {
    assert.equal(trackRowTrailing({ durationMs: 187_000 }), "3:07");
  });

  test("a song whose length isn't known leaves the cell empty", () => {
    assert.equal(trackRowTrailing({ durationMs: null }), "");
  });
});

describe("trackRowTrailing in Portuguese", () => {
  test("plays are counted in Portuguese", () => {
    assert.equal(trackRowTrailing({ durationMs: 1000, countedPlays: 1 }, "pt-BR"), "1 reprodução");
    assert.equal(
      trackRowTrailing({ durationMs: 1000, countedPlays: 1200 }, "pt-BR"),
      "1.200 reproduções",
    );
  });
});
