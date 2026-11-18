import assert from "node:assert/strict";
import { test } from "node:test";
import { readLanguageChoice, chosenAppLanguage } from "./index.ts";

test("an explicit language overrides the device, while System follows its ordered languages", () => {
  assert.equal(chosenAppLanguage("en", ["pt-BR"]), "en");
  assert.equal(chosenAppLanguage("pt-BR", ["en-US"]), "pt-BR");
  assert.equal(chosenAppLanguage("system", ["es", "pt-PT", "en"]), "pt-BR");
  assert.equal(chosenAppLanguage("system", []), "en");
  for (const value of [null, undefined, "fr", "", "system"])
    assert.equal(readLanguageChoice(value), "system");
  assert.equal(readLanguageChoice("en"), "en");
  assert.equal(readLanguageChoice("pt-BR"), "pt-BR");
});
