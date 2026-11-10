import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, test } from "node:test";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

/**
 * Export to YT Music's run, with YT Music's side (`ytSharedPlaylists.ts`)
 * and the progress board stubbed: each stub writes what it was asked to
 * `globalThis.exportTest`, and the test sets what matching answers.
 */
interface ExportTest {
  readonly calls: string[];
  /** The playlist's name and its songs found / total, by playlist id; absent means deleted. */
  playlists: Map<number, { name: string; found: number; total: number }>;
  /** A playlist whose matching fails, as an unanswered search does. */
  failing: number | null;
  /** Runs once while a playlist is being matched, as a tap during the export would. */
  duringMatch: ((id: number) => void) | null;
}
const shared: ExportTest = { calls: [], playlists: new Map(), failing: null, duringMatch: null };
Object.assign(globalThis, { exportTest: shared });

const core = JSON.stringify(import.meta.resolve("@wave/core"));
const stubs: Record<string, string> = {
  "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${core};
    export const currentLocalisation = () => ({ language: "en", strings: catalogueOf("en") });
  `),
  "@/log/appLog": stubModule(`
    export const appLog = (level, tag, message) => globalThis.exportTest.calls.push("log " + message);
  `),
  "@/overlay/alert": stubModule(`
    export const showError = async (title, error) =>
      globalThis.exportTest.calls.push("error " + title + ": " + error.message);
  `),
  "@/overlay/toast": stubModule(`
    export const showToast = async (text) => globalThis.exportTest.calls.push("toast " + text);
  `),
  "@/share/ytSharedPlaylists": stubModule(`
    const t = globalThis.exportTest;
    export const matchOnYtMusic = async (id, progress) => {
      t.calls.push("match " + id);
      const during = t.duringMatch;
      t.duringMatch = null;
      during?.(id);
      if (t.failing === id) throw new Error("no answer");
      const playlist = t.playlists.get(id);
      if (playlist === undefined) return null;
      progress(0, playlist.total);
      progress(playlist.total, playlist.total);
      const ids = Array.from({ length: playlist.found }, (_, i) => id + "-" + i);
      return { name: playlist.name, songs: { ids, found: playlist.found, total: playlist.total } };
    };
    export const likeFavoritesOnYtMusic = async (progress) => {
      t.calls.push("favorites");
      if (t.failing === -1) throw new Error("signed out");
      progress(0, 3);
      progress(3, 3);
      return { ids: ["old", "new"], found: 2, total: 3 };
    };
    export const ytMusicPlaylists = (id, purpose) => ({
      recall: async () => null,
      remember: async (playlistId) => t.calls.push("remember " + id + " " + playlistId),
      read: async () => null,
      change: async () => {},
      move: async () => {},
      create: async (name, ids) => {
        t.calls.push("create " + purpose + " " + name + " " + ids.length);
        return "PL" + id;
      },
    });
    export const ytMusicFailureMessage = (error) => "Failed: " + error.message;
  `),
  "./importProgress": stubModule(`
    const t = globalThis.exportTest;
    export const FAVORITES_EXPORT_ID = -1;
    export const showExportProgress = (id, progress) =>
      t.calls.push("progress " + id + " " + progress.phase + ("done" in progress ? " " + progress.done + "/" + progress.total : ""));
    export const endExportProgress = (id) => t.calls.push("end " + id);
  `),
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { exportToYtMusic } = await import("./ytExportRun.ts");

const playlist = (playlistId: number, name: string) =>
  ({ kind: "playlist", playlistId, name }) as const;

beforeEach(() => {
  shared.calls.length = 0;
  shared.playlists = new Map([
    [1, { name: "Road trip", found: 2, total: 3 }],
    [2, { name: "Gym", found: 1, total: 1 }],
  ]);
  shared.failing = null;
  shared.duringMatch = null;
});

test("exports each playlist in order as a private copy, then sums it up", async () => {
  await exportToYtMusic([playlist(1, "Road trip"), playlist(2, "Gym")]);
  assert.deepEqual(shared.calls, [
    "progress 1 exportWaiting",
    "progress 2 exportWaiting",
    "match 1",
    "progress 1 exporting 0/3",
    "progress 1 exporting 3/3",
    "create export Road trip 2",
    "remember 1 PL1",
    "end 1",
    "match 2",
    "progress 2 exporting 0/1",
    "progress 2 exporting 1/1",
    "create export Gym 1",
    "remember 2 PL2",
    "end 2",
    "log Exported 2 playlists, 3 of 4 songs found",
    "toast 2 playlists exported · 3 of 4 songs found",
  ]);
});

test("names each playlist as it's called when its turn comes, and skips one deleted meanwhile", async () => {
  shared.playlists.set(2, { name: "Gym 2026", found: 1, total: 1 });
  shared.playlists.delete(1);
  await exportToYtMusic([playlist(1, "Road trip"), playlist(2, "Gym")]);
  assert.ok(shared.calls.includes("create export Gym 2026 1"));
  assert.ok(!shared.calls.some((call) => call.startsWith("create export Road trip")));
  assert.equal(shared.calls.at(-1), "toast 1 playlist exported · 1 of 1 song found");
});

test("stops at a failure with Share's message, keeping what was sent and clearing every line", async () => {
  shared.failing = 2;
  await exportToYtMusic([playlist(1, "Road trip"), playlist(2, "Gym"), playlist(3, "Later")]);
  assert.ok(shared.calls.includes("remember 1 PL1"));
  assert.ok(!shared.calls.includes("match 3"));
  assert.deepEqual(shared.calls.slice(-4), [
    "end 2",
    "end 3",
    "log Export to YT Music stopped after 1 playlists, 2 of 3 songs found",
    "error Couldn't export the playlists: Failed: no answer",
  ]);
  assert.ok(!shared.calls.some((call) => call.startsWith("toast")));
});

test("an Export pressed while another runs goes after it", async () => {
  const first = exportToYtMusic([playlist(1, "Road trip")]);
  const second = exportToYtMusic([playlist(2, "Gym")]);
  await Promise.all([first, second]);
  const order = shared.calls.filter((call) => call.startsWith("match") || call.startsWith("toast"));
  assert.deepEqual(order, [
    "match 1",
    "toast 1 playlist exported · 2 of 3 songs found",
    "match 2",
    "toast 1 playlist exported · 1 of 1 song found",
  ]);
});

test("exports Favorites before playlists, clears its progress and counts likes", async () => {
  await exportToYtMusic([{ kind: "favorites" }, playlist(1, "Road trip")]);
  assert.ok(shared.calls.indexOf("favorites") < shared.calls.indexOf("match 1"));
  assert.ok(shared.calls.includes("progress -1 exportWaiting"));
  assert.ok(shared.calls.includes("progress -1 exporting 3/3"));
  assert.ok(shared.calls.includes("end -1"));
  assert.deepEqual(shared.calls.slice(-2), [
    "log Exported 1 playlists, 4 of 6 songs found, 2 liked",
    "toast 1 playlist exported · 4 of 6 songs found · 2 liked",
  ]);
});

test("a refused favorite stops the export and clears queued playlist progress", async () => {
  shared.failing = -1;
  await exportToYtMusic([{ kind: "favorites" }, playlist(1, "Road trip")]);
  assert.ok(!shared.calls.includes("match 1"));
  assert.ok(shared.calls.includes("end -1"));
  assert.ok(shared.calls.includes("end 1"));
  assert.ok(shared.calls.at(-1)?.includes("signed out"));
});

test("a playlist with no song found isn't made on YT Music, as Share makes nothing", async () => {
  shared.playlists.set(3, { name: "Obscure", found: 0, total: 2 });
  await exportToYtMusic([playlist(1, "Road trip"), playlist(3, "Obscure")]);
  assert.ok(!shared.calls.some((call) => call.startsWith("create export Obscure")));
  assert.ok(!shared.calls.includes("remember 3 PL3"));
  assert.ok(shared.calls.includes("end 3"));
  assert.deepEqual(shared.calls.slice(-2), [
    "log Exported 1 playlists, 2 of 5 songs found",
    "toast 1 playlist exported · 2 of 5 songs found",
  ]);
});

test("a playlist queued in a second Export goes back to Waiting when the first sends it", async () => {
  const first = exportToYtMusic([playlist(1, "Road trip")]);
  const second = exportToYtMusic([playlist(1, "Road trip")]);
  await Promise.all([first, second]);
  const lines = shared.calls.filter((call) => /^(progress|end) 1\b/.test(call));
  assert.deepEqual(lines, [
    "progress 1 exportWaiting",
    "progress 1 exportWaiting",
    "progress 1 exporting 0/3",
    "progress 1 exporting 3/3",
    "progress 1 exportWaiting",
    "progress 1 exporting 0/3",
    "progress 1 exporting 3/3",
    "end 1",
  ]);
});

test("an Export pressed while a playlist is being sent keeps its line, then shows it waiting", async () => {
  let second: Promise<void> = Promise.resolve();
  shared.duringMatch = () => {
    second = exportToYtMusic([playlist(1, "Road trip")]);
  };
  await exportToYtMusic([playlist(1, "Road trip"), playlist(2, "Gym")]);
  await second;
  const lines = shared.calls.filter((call) => /^(progress|end|match) 1\b/.test(call));
  assert.deepEqual(lines, [
    "progress 1 exportWaiting",
    "match 1",
    "progress 1 exporting 0/3",
    "progress 1 exporting 3/3",
    "progress 1 exportWaiting",
    "match 1",
    "progress 1 exporting 0/3",
    "progress 1 exporting 3/3",
    "end 1",
  ]);
});

test("a failure keeps the line of a playlist another Export still has queued", async () => {
  shared.failing = 1;
  const first = exportToYtMusic([playlist(1, "Road trip"), playlist(2, "Gym")]);
  const second = exportToYtMusic([playlist(2, "Gym")]);
  await first;
  const afterFailure = shared.calls.slice(shared.calls.indexOf("match 1"));
  assert.ok(afterFailure.includes("end 1"));
  assert.ok(!afterFailure.includes("end 2"));
  await second;
  assert.equal(shared.calls.filter((call) => call === "match 2").length, 1);
  assert.ok(shared.calls.at(-3) === "end 2");
});
