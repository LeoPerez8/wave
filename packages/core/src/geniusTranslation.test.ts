import assert from "node:assert/strict";
import { test } from "node:test";

import {
  geniusAbout,
  geniusTranslationRequest,
  geniusTranslationTarget,
  savedGenius,
  storedGenius,
  withGeniusTranslation,
  type SavedGenius,
} from "./index.ts";

const song = { title: "Imagine", artist: "John Lennon" };
const answer: SavedGenius = {
  checkedAt: 100,
  match: null,
  description: "A song about peace.\n\nIts second paragraph.",
  referents: null,
  translations: {},
};
const PORTUGUESE = "Uma canção sobre paz.\n\nSeu segundo parágrafo.";

test("only an app in pt-BR translates Genius's text", () => {
  assert.equal(geniusTranslationTarget("pt-BR"), "pt");
  assert.equal(geniusTranslationTarget("en"), null);
});

test("the About is sent whole to Google, paragraphs and all", () => {
  const request = geniusTranslationRequest(answer, "pt");
  assert.equal(
    request?.url,
    "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=pt",
  );
  assert.equal(request?.body, "q=A%20song%20about%20peace.%0A%0AIts%20second%20paragraph.");
});

test("an answer without a description asks nothing", () => {
  assert.equal(geniusTranslationRequest({ ...answer, description: null }, "pt"), null);
});

test("the original shows until Google's reply is read, then the translation", () => {
  assert.equal(geniusAbout(answer, "pt"), answer.description);
  const translated = withGeniusTranslation(answer, "pt", [[PORTUGUESE, "en"]]);
  assert.ok(translated !== null);
  assert.equal(geniusAbout(translated, "pt"), PORTUGUESE);
  assert.equal(translated.description, answer.description);
  assert.equal(geniusTranslationRequest(translated, "pt"), null);
});

test("an app in English shows the original of a translated answer", () => {
  const translated = withGeniusTranslation(answer, "pt", [[PORTUGUESE, "en"]]);
  assert.equal(geniusAbout(translated!, null), answer.description);
});

test("text already in Portuguese shows as it came and isn't asked again", () => {
  const already = { ...answer, description: "Uma canção sobre paz." };
  const read = withGeniusTranslation(already, "pt", [["Uma cancao sobre a paz.", "pt-BR"]]);
  assert.ok(read !== null);
  assert.equal(geniusAbout(read, "pt"), "Uma canção sobre paz.");
  assert.equal(geniusTranslationRequest(read, "pt"), null);
});

test("a reply that doesn't answer the request is a failure", () => {
  for (const reply of [
    null,
    {},
    [],
    [
      [PORTUGUESE, "en"],
      ["more", "en"],
    ],
    [[1, "en"]],
    [["  ", "en"]],
  ])
    assert.equal(withGeniusTranslation(answer, "pt", reply), null);
});

test("the translation comes back from the saved answer", () => {
  const translated = withGeniusTranslation(answer, "pt", [[PORTUGUESE, "en"]])!;
  const read = savedGenius(storedGenius(song, translated), 200, song);
  assert.deepEqual(read, translated);
});

test("an answer saved before this feature reads with no translation and is asked", () => {
  const old = JSON.stringify({
    version: 1,
    asked: song,
    checkedAt: 100,
    match: null,
    description: "About",
    referents: null,
  });
  const read = savedGenius(old, 200, song);
  assert.equal(read?.description, "About");
  assert.deepEqual(read?.translations, {});
  assert.equal(geniusTranslationRequest(read!, "pt")?.body, "q=About");
});

test("unreadable saved translations cost the translations, not the answer", () => {
  const stored = JSON.parse(storedGenius(song, answer));
  for (const translations of ["bad", 1, { key: 2 }, ["x"]]) {
    const read = savedGenius(JSON.stringify({ ...stored, translations }), 200, song);
    assert.equal(read?.description, answer.description);
    assert.deepEqual(read?.translations, {});
  }
});

test("a description that changed isn't shown the old translation and is asked anew", () => {
  const translated = withGeniusTranslation(answer, "pt", [[PORTUGUESE, "en"]])!;
  const changed = { ...translated, description: "A new description." };
  assert.equal(geniusAbout(changed, "pt"), "A new description.");
  assert.equal(geniusTranslationRequest(changed, "pt")?.body, "q=A%20new%20description.");
  const again = withGeniusTranslation(changed, "pt", [["Uma nova descrição.", "en"]])!;
  assert.equal(geniusAbout(again, "pt"), "Uma nova descrição.");
  assert.equal(Object.keys(again.translations).length, 1);
});
