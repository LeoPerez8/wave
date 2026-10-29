import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  appLyricsTranslationTarget,
  lyricsTranslationKey,
  lyricsTranslationLanguageName,
  lyricsTranslationRequest,
  lyricsTranslationTarget,
  parseLyricsTranslation,
  savedLyricsTranslation,
  storedLyricsTranslation,
} from "./index.ts";

/** A reply Google Translate's endpoint gave, trimmed (docs/google-translate-samples). */
const sample = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../docs/google-translate-samples/${name}`, import.meta.url),
      "utf8",
    ),
  );

/** The lines `english-to-portuguese.json` answers, with a pause and a gap between verses. */
const ENGLISH = [
  "I walked along the empty road",
  "The city lights were fading slow",
  "",
  "Oh, oh, oh",
  "And every word I couldn't say",
  "",
  "Is waiting for the light of day",
];

describe("the request for a song's translation", () => {
  test("sends each line with words as its own text, for the phone's language", () => {
    assert.deepEqual(
      lyricsTranslationRequest(["I walked along", "", "  the empty road ", "Oh & ah"], "pt"),
      {
        url: "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=pt",
        body: "q=I%20walked%20along&q=the%20empty%20road&q=Oh%20%26%20ah",
      },
    );
  });

  test("lyrics without a word send nothing", () => {
    assert.equal(lyricsTranslationRequest(["", "  ", ""], "pt"), null);
  });
});

describe("reading the reply back", () => {
  test("gives one translation per line, empty lines and gaps kept in place", () => {
    assert.deepEqual(parseLyricsTranslation(ENGLISH, "pt", sample("english-to-portuguese.json")), {
      kind: "translated",
      from: "en",
      lines: [
        "Eu caminhei pela estrada vazia",
        "As luzes da cidade estavam desaparecendo lentamente",
        null,
        "Ah, ah, ah",
        "E cada palavra que eu não pude dizer",
        null,
        "Está esperando pela luz do dia",
      ],
    });
  });

  test("lyrics mostly in the phone's language are already in it, whatever a stray line says", () => {
    const portuguese = [
      "Eu andei pela estrada vazia",
      "As luzes da cidade se apagavam devagar",
      "Oh, oh, oh",
    ];
    assert.deepEqual(
      parseLyricsTranslation(portuguese, "pt", sample("portuguese-to-portuguese.json")),
      { kind: "sameLanguage", language: "pt" },
    );
  });

  test("a regional phone language matches the language Google names", () => {
    assert.deepEqual(parseLyricsTranslation(["Hello"], "en-GB", [["Hello", "en"]]), {
      kind: "sameLanguage",
      language: "en-GB",
    });
  });

  test("Chinese in the other script is still translated", () => {
    assert.deepEqual(parseLyricsTranslation(["你好"], "zh-TW", [["你好", "zh-CN"]]), {
      kind: "translated",
      from: "zh-CN",
      lines: [null],
    });
  });

  test("a reply that doesn't answer every line is unreadable", () => {
    assert.equal(parseLyricsTranslation(ENGLISH, "pt", sample("one-line.json")), null);
    assert.equal(parseLyricsTranslation(["Hello"], "pt", { error: "quota" }), null);
    assert.equal(parseLyricsTranslation(["Hello"], "pt", [[1, "en"]]), null);
  });
});

describe("the phone's language", () => {
  test("is its language without the region, as Google Translate names it", () => {
    assert.equal(lyricsTranslationTarget("pt-BR"), "pt");
    assert.equal(lyricsTranslationTarget("en_US"), "en");
    assert.equal(lyricsTranslationTarget("de"), "de");
  });

  test("keeps the script for Chinese and the region for European Portuguese", () => {
    assert.equal(lyricsTranslationTarget("zh-Hant-TW"), "zh-TW");
    assert.equal(lyricsTranslationTarget("zh-HK"), "zh-TW");
    assert.equal(lyricsTranslationTarget("zh-Hans-CN"), "zh-CN");
    assert.equal(lyricsTranslationTarget("pt-PT"), "pt-PT");
  });

  test("an unknown phone language falls back to English", () => {
    assert.equal(lyricsTranslationTarget(""), "en");
    assert.equal(lyricsTranslationTarget("und"), "en");
  });

  test("is named in English for the same-language note", () => {
    assert.equal(lyricsTranslationLanguageName("pt"), "Portuguese");
    assert.equal(lyricsTranslationLanguageName("pt-PT"), "Portuguese");
    assert.equal(lyricsTranslationLanguageName("zh-TW"), "Chinese (Traditional)");
    assert.equal(lyricsTranslationLanguageName("he"), "Hebrew");
    assert.equal(lyricsTranslationLanguageName("xx"), "xx");
  });
});

describe("a saved translation", () => {
  const translated = parseLyricsTranslation(ENGLISH, "pt", sample("english-to-portuguese.json"))!;

  test("is kept per song and per phone language", () => {
    const keys = new Set([
      lyricsTranslationKey("library:12", "pt"),
      lyricsTranslationKey("library:12", "de"),
      lyricsTranslationKey("library:13", "pt"),
      lyricsTranslationKey("yt:abc", "pt"),
    ]);
    assert.equal(keys.size, 4);
    assert.equal(
      lyricsTranslationKey("library:12", "pt"),
      lyricsTranslationKey("library:12", "pt"),
    );
  });

  test("reads back for the same lyrics, with no request", () => {
    const stored = storedLyricsTranslation(ENGLISH, translated);
    assert.deepEqual(savedLyricsTranslation(stored, ENGLISH), translated);
  });

  test("a same-language answer is kept too, so the song isn't asked again", () => {
    const same = { kind: "sameLanguage", language: "pt" } as const;
    assert.deepEqual(savedLyricsTranslation(storedLyricsTranslation(["Olá"], same), ["Olá"]), same);
  });

  test("is dropped once the song's lyrics change", () => {
    const stored = storedLyricsTranslation(ENGLISH, translated);
    assert.equal(
      savedLyricsTranslation(stored, [...ENGLISH.slice(0, -1), "Is waiting for the night"]),
      null,
    );
    assert.equal(savedLyricsTranslation(stored, ENGLISH.slice(1)), null);
  });

  test("nothing saved, or something unreadable, is no translation", () => {
    assert.equal(savedLyricsTranslation(null, ENGLISH), null);
    assert.equal(savedLyricsTranslation("{not json", ENGLISH), null);
    assert.equal(savedLyricsTranslation('{"lyrics":"x"}', ENGLISH), null);
  });
});

describe("lyrics in the app's language", () => {
  test("translate into Portuguese for an app in pt-BR and English for an app in English", () => {
    assert.equal(appLyricsTranslationTarget("pt-BR"), "pt");
    assert.equal(appLyricsTranslationTarget("en"), "en");
  });

  test("keep an English translation saved from an English phone", () => {
    assert.equal(
      lyricsTranslationKey("track-1", appLyricsTranslationTarget("en")),
      lyricsTranslationKey("track-1", lyricsTranslationTarget("en-US")),
    );
  });

  test("names the same language in English", () => {
    assert.equal(lyricsTranslationLanguageName("en", catalogueOf("en")), "English");
  });

  test("names the same language in Portuguese", () => {
    assert.equal(lyricsTranslationLanguageName("en", catalogueOf("pt-BR")), "inglês");
    assert.equal(lyricsTranslationLanguageName("pt", catalogueOf("pt-BR")), "português");
    assert.equal(lyricsTranslationLanguageName("xx", catalogueOf("pt-BR")), "xx");
  });
});
