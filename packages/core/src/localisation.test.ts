import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf, plural, resolveAppLanguage } from "./index.ts";

describe("resolveAppLanguage", () => {
  for (const tag of ["pt-BR", "pt-PT", "pt"]) {
    test(`${tag} reads in Brazilian Portuguese when Portuguese is enabled`, () => {
      assert.equal(resolveAppLanguage([tag], { portugueseEnabled: true }), "pt-BR");
    });

    test(`${tag} reads in English when Portuguese isn't enabled`, () => {
      assert.equal(resolveAppLanguage([tag], { portugueseEnabled: false }), "en");
    });
  }

  test("any other language reads in English", () => {
    assert.equal(resolveAppLanguage(["es-ES"], { portugueseEnabled: true }), "en");
    assert.equal(resolveAppLanguage(["en-US"], { portugueseEnabled: true }), "en");
  });

  test("no language at all reads in English", () => {
    assert.equal(resolveAppLanguage([], { portugueseEnabled: true }), "en");
  });

  test("the first supported language in the phone's list wins", () => {
    const enabled = { portugueseEnabled: true };
    assert.equal(resolveAppLanguage(["es-ES", "pt-BR", "en-US"], enabled), "pt-BR");
    assert.equal(resolveAppLanguage(["es-ES", "en-GB", "pt-BR"], enabled), "en");
    assert.equal(resolveAppLanguage(["fr-FR", "pt-PT"], enabled), "pt-BR");
  });

  test("without Portuguese, a Portuguese phone with English further down reads in English", () => {
    assert.equal(resolveAppLanguage(["pt-BR", "en-US"], { portugueseEnabled: false }), "en");
  });

  test("tags are read whatever their case or separator", () => {
    const enabled = { portugueseEnabled: true };
    assert.equal(resolveAppLanguage(["PT_br"], enabled), "pt-BR");
    assert.equal(resolveAppLanguage(["pt-Latn-BR"], enabled), "pt-BR");
    assert.equal(resolveAppLanguage(["ptx"], enabled), "en");
  });
});

describe("plural", () => {
  const songs = (count: number) => ({
    one: `${count} song`,
    other: `${count} songs`,
  });
  const músicas = (count: number) => ({
    one: `${count} música`,
    other: `${count} músicas`,
  });

  test("English: one for 1, other for 0, 2 and a large number", () => {
    assert.equal(plural("en", 0, songs(0)), "0 songs");
    assert.equal(plural("en", 1, songs(1)), "1 song");
    assert.equal(plural("en", 2, songs(2)), "2 songs");
    assert.equal(plural("en", 12_345, songs(12_345)), "12345 songs");
  });

  test("Portuguese: one for 0 and 1, other for 2 and a large number", () => {
    assert.equal(plural("pt-BR", 0, músicas(0)), "0 música");
    assert.equal(plural("pt-BR", 1, músicas(1)), "1 música");
    assert.equal(plural("pt-BR", 2, músicas(2)), "2 músicas");
    assert.equal(plural("pt-BR", 12_345, músicas(12_345)), "12345 músicas");
  });

  test("an explicit zero reads instead of the rule for 0, in both languages", () => {
    assert.equal(plural("en", 0, { ...songs(0), zero: "No songs" }), "No songs");
    assert.equal(plural("pt-BR", 0, { ...músicas(0), zero: "Nenhuma música" }), "Nenhuma música");
    assert.equal(plural("pt-BR", 1, { ...músicas(1), zero: "Nenhuma música" }), "1 música");
    assert.equal(plural("en", 2, { ...songs(2), zero: "No songs" }), "2 songs");
  });
});

describe("catalogueOf", () => {
  test("English names the tabs as Wave always has", () => {
    const { tabs } = catalogueOf("en");
    assert.deepEqual(
      [tabs.index, tabs.library, tabs.search, tabs.songs, tabs.favorites],
      ["Home", "Library", "Search", "Songs", "Favorites"],
    );
  });

  test("Brazilian Portuguese names the tabs as Apple Music does", () => {
    const { tabs } = catalogueOf("pt-BR");
    assert.deepEqual(
      [tabs.index, tabs.library, tabs.search, tabs.songs, tabs.favorites],
      ["Início", "Biblioteca", "Buscar", "Músicas", "Favoritas"],
    );
  });
});
