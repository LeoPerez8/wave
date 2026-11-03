import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReleaseAnswer } from "@wave/core";
import { followReleaseEligibility } from "./releaseEligibility.ts";

test("network, preference and YT Music changes resume only eligible background work", () => {
  let allowed = false;
  let runs = 0;
  const listeners: (() => void)[] = [];
  const subscribe = (listener: () => void) => {
    listeners.push(listener);
    return () => {};
  };
  followReleaseEligibility(
    () => allowed,
    () => runs++,
    [subscribe, subscribe, subscribe],
  );
  assert.equal(listeners.length, 3);
  for (const changed of listeners) {
    allowed = false;
    changed();
    assert.equal(runs, 0);
  }
  for (const changed of listeners) {
    allowed = true;
    changed();
  }
  assert.equal(runs, 3);
});

test("stopping during a host wait keeps answers and resumes only songs still due; playlists keep going", async () => {
  const { lookUpReleaseDates, releaseBackgroundAllowed } = await import("@wave/core");
  const { releaseLookupClient } = await import("./releaseLookupClient.ts");
  for (const stop of ["mobile", "onDemand", "ytOff"] as const) {
    for (const playlist of [false, true]) {
      let mobile = false;
      let preference: "wifi" | "onDemand" = "wifi";
      let ytMusic = true;
      let waits = 0;
      const calls: string[] = [];
      const saved = new Map<string, ReleaseAnswer>();
      const going = () =>
        playlist || releaseBackgroundAllowed(preference, { onMobileData: mobile, ytMusic });
      const client = releaseLookupClient(
        async (url) => {
          calls.push(url);
          return { status: 200, json: async () => ({ data: [] }) };
        },
        async () => {
          if (++waits === 2) {
            if (stop === "mobile") mobile = true;
            if (stop === "onDemand") preference = "onDemand";
            if (stop === "ytOff") ytMusic = false;
          }
        },
        () => 100,
        going,
      );
      const songs = ["Saved", "First", "Second"].map((title) => ({
        title,
        artist: "Artist",
        key: title,
        year: null,
        held: null,
        answer:
          title === "Saved" ? { date: null, source: "unknown" as const, retryAt: 1000 } : null,
      }));
      const run = () =>
        lookUpReleaseDates({
          songs: songs.map((song) => ({ ...song, answer: saved.get(song.key) ?? song.answer })),
          services: client,
          now: () => 100,
          going,
          answered: async (song, answer) => {
            saved.set(song.key, answer);
          },
          progress: () => {},
        });
      assert.equal(await run(), playlist ? "done" : "stopped");
      assert.equal(calls.length, playlist ? 2 : 1);
      mobile = false;
      preference = "wifi";
      ytMusic = true;
      assert.equal(await run(), "done");
      const completedCalls = calls.length;
      assert.equal(await run(), "done");
      assert.equal(calls.length, completedCalls);
      assert.ok(calls.every((url) => !url.includes("Saved")));
      assert.equal(saved.size, 2);
    }
  }
});
