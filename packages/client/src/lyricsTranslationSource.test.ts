/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { translateLyrics, type TranslationService } from "./lyricsTranslationSource.ts";

const LINES = ["Hello", "", "Good night"];

/** A phone's key-value store and a Google that answers [reply] (or fails), recording what's asked of them. */
const service = (reply: unknown | Error) => {
  const kept = new Map<string, string>();
  const posted: { url: string; body: string }[] = [];
  const translation: TranslationService = {
    read: async (key) => kept.get(key) ?? null,
    keep: async (key, value) => {
      kept.set(key, value);
    },
    drop: async (key) => {
      kept.delete(key);
    },
    post: async (url, body) => {
      posted.push({ url, body });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
  return { translation, kept, posted };
};

const TRANSLATED = [
  ["Olá", "en"],
  ["Boa noite", "en"],
];

describe("translating a song's lyrics", () => {
  test("asks Google once, then reads the saved translation with no request", async () => {
    const { translation, posted } = service(TRANSLATED);
    const ask = { song: "library:1", lines: LINES, target: "pt" };
    const first = await translateLyrics(ask, translation);
    const again = await translateLyrics(ask, translation);
    const expected = { kind: "translated", from: "en", lines: ["Olá", null, "Boa noite"] };
    assert.deepEqual(first, expected);
    assert.deepEqual(again, expected);
    assert.equal(posted.length, 1);
  });

  test("a same-language answer is saved, so the song isn't asked again", async () => {
    const { translation, posted } = service([
      ["Olá", "pt"],
      ["Boa noite", "pt"],
    ]);
    const ask = { song: "library:1", lines: ["Olá", "Boa noite"], target: "pt" };
    assert.deepEqual(await translateLyrics(ask, translation), {
      kind: "sameLanguage",
      language: "pt",
    });
    await translateLyrics(ask, translation);
    assert.equal(posted.length, 1);
  });

  test("a failed request saves nothing and says it failed", async () => {
    const { translation, kept } = service(new Error("offline"));
    const ask = { song: "library:1", lines: LINES, target: "pt" };
    assert.equal(await translateLyrics(ask, translation), "failed");
    assert.equal(kept.size, 0);
  });

  test("an unreadable reply counts as a failure", async () => {
    const { translation, kept } = service("<html>Sorry...</html>");
    const ask = { song: "library:1", lines: LINES, target: "pt" };
    assert.equal(await translateLyrics(ask, translation), "failed");
    assert.equal(kept.size, 0);
  });

  test("changed lyrics drop the old translation and ask again", async () => {
    const { translation, posted } = service(TRANSLATED);
    await translateLyrics({ song: "library:1", lines: LINES, target: "pt" }, translation);
    const changed = await translateLyrics(
      { song: "library:1", lines: ["Hello", "Good night"], target: "pt" },
      translation,
    );
    assert.deepEqual(changed, { kind: "translated", from: "en", lines: ["Olá", "Boa noite"] });
    assert.equal(posted.length, 2);
  });

  test("lyrics without words send nothing", async () => {
    const { translation, posted } = service(TRANSLATED);
    assert.equal(
      await translateLyrics({ song: "library:1", lines: ["", ""], target: "pt" }, translation),
      null,
    );
    assert.equal(posted.length, 0);
  });
});
