import assert from "node:assert/strict";
import test from "node:test";
import { inputKey } from "../../bench/fastAgain/benches/tasteProfile.ts";

test("taste input evidence preserves every field and array order while ignoring object property order", () => {
  const input = {
    magic: [
      { trackId: "1", artists: [], genre: "rock", style: null },
      { trackId: "2", artists: [], genre: null, style: "metal" },
    ],
    playable: [{ trackId: "1", artists: [], genre: "rock", style: null }],
    history: {
      plays: [{ trackId: "1", startedAt: 10, listenedMs: 20, endReason: "completed" as const }],
      favorites: [{ trackId: "2", changedAt: 30 }],
      downloads: [{ trackId: "3", downloadedAt: 40 }],
    },
  };
  assert.equal(
    inputKey(input),
    inputKey({
      ...input,
      magic: input.magic.map((song) => ({
        genre: song.genre,
        style: song.style,
        artists: song.artists,
        trackId: song.trackId,
      })),
      history: {
        plays: [{ startedAt: 10, listenedMs: 20, endReason: "completed", trackId: "1" }],
        favorites: [{ changedAt: 30, trackId: "2" }],
        downloads: [{ downloadedAt: 40, trackId: "3" }],
      },
    }),
  );
  assert.notEqual(inputKey(input), inputKey({ ...input, magic: input.magic.toReversed() }));
  assert.notEqual(inputKey(input), inputKey({ ...input, playable: [] }));
  for (const history of [
    { ...input.history, plays: [{ ...input.history.plays[0]!, listenedMs: 21 }] },
    { ...input.history, plays: [{ ...input.history.plays[0]!, endReason: "skipped" as const }] },
    { ...input.history, favorites: [{ trackId: "2", changedAt: 31 }] },
    { ...input.history, downloads: [{ trackId: "3", downloadedAt: 41 }] },
    {
      ...input.history,
      plays: [...input.history.plays, { ...input.history.plays[0]!, trackId: "4" }],
    },
  ])
    assert.notEqual(inputKey(input), inputKey({ ...input, history }));
});
