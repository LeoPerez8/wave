import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";

import type { SongLyrics } from "../../shared/lyrics.ts";
import { createLyricsTranslation } from "./translation.ts";

const SYNCED: SongLyrics = {
  kind: "synced",
  lines: [
    { timeMs: 0, text: "Hello" },
    { timeMs: 5_000, text: "" },
    { timeMs: 9_000, text: "Good night" },
  ],
};

/** Google's answer to the two lines with words, found in English. */
const PORTUGUESE = [
  ["Olá", "en"],
  ["Boa noite", "en"],
];

/** The service over a fresh device store, with the song's lyrics and Google scripted. */
const translationOver = async (
  google: () => Promise<unknown> = async () => PORTUGUESE,
  lyrics: () => SongLyrics = () => SYNCED,
) => {
  const db = await openTestDatabase();
  db.run(
    sql`CREATE TABLE IF NOT EXISTS desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  const posted: { url: string; body: string }[] = [];
  const make = (post: () => Promise<unknown> = google) =>
    createLyricsTranslation({
      db,
      song: async () => lyrics(),
      post: (url, body) => {
        posted.push({ url, body });
        return post();
      },
    });
  return { service: make(), posted, restarted: make };
};

test("Translate is off until it's turned on, and stays on for a new service", async () => {
  const { service, restarted } = await translationOver();
  assert.equal(service.on(), false);
  service.setOn(true);
  assert.equal(restarted().on(), true);
  service.setOn(false);
  assert.equal(restarted().on(), false);
});

test("with Translate off nothing is sent to Google", async () => {
  const { service, posted } = await translationOver();
  assert.deepEqual(await service.song("7", "pt-BR"), { kind: "off" });
  assert.deepEqual(posted, []);
});

test("each line with words is translated into the app's language, in its place", async () => {
  const { service, posted } = await translationOver();
  service.setOn(true);
  assert.deepEqual(await service.song("7", "pt-BR"), {
    kind: "translated",
    lines: ["Olá", null, "Boa noite"],
  });
  assert.equal(posted.length, 1);
  assert.equal(new URL(posted[0]!.url).searchParams.get("tl"), "pt");
  assert.equal(posted[0]!.body, "q=Hello&q=Good%20night");
});

test("a song translated before shows its translation with no request, offline too", async () => {
  const { service, posted, restarted } = await translationOver();
  service.setOn(true);
  const first = await service.song("7", "pt-BR");
  const offline = restarted(() => Promise.reject(new Error("offline")));
  assert.deepEqual(await offline.song("7", "pt-BR"), first);
  assert.equal(posted.length, 1);
});

test("the saved translation is dropped when the song's lyrics change", async () => {
  let lyrics: SongLyrics = SYNCED;
  const { service, posted } = await translationOver(
    async () => [["Tchau", "en"]],
    () => lyrics,
  );
  service.setOn(true);
  lyrics = { kind: "unsynced", lines: ["Goodbye"] };
  await service.song("7", "pt-BR");
  lyrics = { kind: "unsynced", lines: ["Farewell"] };
  assert.deepEqual(await service.song("7", "pt-BR"), { kind: "translated", lines: ["Tchau"] });
  assert.equal(posted.length, 2);
});

test("lyrics already in the app's language say so and show no translation", async () => {
  const { service } = await translationOver(async () => [
    ["Hello", "en"],
    ["Good night", "en"],
  ]);
  service.setOn(true);
  assert.deepEqual(await service.song("7", "en"), { kind: "sameLanguage", language: "en" });
});

test("a request that fails answers failed and saves nothing, so Try Again asks again", async () => {
  let fail = true;
  const { service, posted } = await translationOver(() =>
    fail ? Promise.reject(new Error("offline")) : Promise.resolve(PORTUGUESE),
  );
  service.setOn(true);
  assert.deepEqual(await service.song("7", "pt-BR"), { kind: "failed" });
  fail = false;
  assert.equal((await service.song("7", "pt-BR")).kind, "translated");
  assert.equal(posted.length, 2);
});

test("two views asking for the same song at once share one request", async () => {
  const { service, posted } = await translationOver();
  service.setOn(true);
  const [panel, nowPlaying] = await Promise.all([
    service.song("7", "pt-BR"),
    service.song("7", "pt-BR"),
  ]);
  assert.deepEqual(panel, nowPlaying);
  assert.equal(posted.length, 1);
});

test("a song with no lyrics asks nothing", async () => {
  const { service, posted } = await translationOver(undefined, () => ({ kind: "none" }));
  service.setOn(true);
  assert.deepEqual(await service.song("7", "pt-BR"), { kind: "off" });
  assert.deepEqual(posted, []);
});
