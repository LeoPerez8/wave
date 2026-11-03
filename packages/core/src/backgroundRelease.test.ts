import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseBackgroundAllowed } from "./index.ts";

test("background release lookup follows Search online only while YT Music is on", () => {
  for (const ytMusic of [true, false]) {
    assert.equal(releaseBackgroundAllowed("always", { onMobileData: true, ytMusic }), ytMusic);
    assert.equal(releaseBackgroundAllowed("always", { onMobileData: false, ytMusic }), ytMusic);
    assert.equal(releaseBackgroundAllowed("wifi", { onMobileData: false, ytMusic }), ytMusic);
    assert.equal(releaseBackgroundAllowed("wifi", { onMobileData: true, ytMusic }), false);
    assert.equal(releaseBackgroundAllowed("onDemand", { onMobileData: false, ytMusic }), false);
    assert.equal(releaseBackgroundAllowed("onDemand", { onMobileData: true, ytMusic }), false);
  }
});

test("a playlist request interrupts a general lookup without creating a failed retry", async () => {
  const { lookUpReleaseDates } = await import("./index.ts");
  let general = true;
  const searched: string[] = [];
  const answers: string[] = [];
  const end = await lookUpReleaseDates({
    songs: ["First", "Second"].map((title) => ({
      title,
      artist: "Artist",
      key: title,
      year: null,
      held: null,
      answer: null,
    })),
    now: () => 100,
    going: () => general,
    services: {
      search: async (title) => {
        searched.push(title);
        general = false;
        throw new Error("Lookup paused");
      },
      recordings: async () => {
        throw new Error("Unexpected request");
      },
      album: async () => {
        throw new Error("Unexpected request");
      },
      titled: async () => {
        throw new Error("Unexpected request");
      },
    },
    answered: async (song) => {
      answers.push(song.key);
    },
    progress: () => {},
  });
  assert.equal(end, "stopped");
  assert.deepEqual(searched, ["First"]);
  assert.deepEqual(answers, []);
});
