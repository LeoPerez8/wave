import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf, plural, resolveAppLanguage } from "./index.ts";

describe("resolveAppLanguage", () => {
  for (const tag of ["pt-BR", "pt-PT", "pt"]) {
    test(`${tag} reads in Brazilian Portuguese`, () => {
      assert.equal(resolveAppLanguage([tag]), "pt-BR");
    });
  }

  test("any other language reads in English", () => {
    assert.equal(resolveAppLanguage(["es-ES"]), "en");
    assert.equal(resolveAppLanguage(["en-US"]), "en");
  });

  test("no language at all reads in English", () => {
    assert.equal(resolveAppLanguage([]), "en");
  });

  test("the first supported language in the phone's list wins", () => {
    assert.equal(resolveAppLanguage(["es-ES", "pt-BR", "en-US"]), "pt-BR");
    assert.equal(resolveAppLanguage(["es-ES", "en-GB", "pt-BR"]), "en");
    assert.equal(resolveAppLanguage(["fr-FR", "pt-PT"]), "pt-BR");
    assert.equal(resolveAppLanguage(["pt-BR", "en-US"]), "pt-BR");
  });

  test("tags are read whatever their case or separator", () => {
    assert.equal(resolveAppLanguage(["PT_br"]), "pt-BR");
    assert.equal(resolveAppLanguage(["pt-Latn-BR"]), "pt-BR");
    assert.equal(resolveAppLanguage(["ptx"]), "en");
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

  test("the desktop names itself the computer where the phone names the phone", () => {
    assert.equal(catalogueOf("en", "desktop").playbackText.thisPhone, "This computer");
    assert.equal(catalogueOf("pt-BR", "desktop").playbackText.thisPhone, "Este computador");
    assert.equal(catalogueOf("en", "phone").playbackText.thisPhone, "This phone");
    assert.equal(catalogueOf("pt-BR").playbackText.thisPhone, "Este celular");
  });

  test("each desktop variant reads in both languages", () => {
    const changed = (language: "en" | "pt-BR"): string[] => {
      const paths: string[] = [];
      const walk = (phone: unknown, desktop: unknown, path: string): void => {
        if (phone === desktop) return;
        if (typeof phone === "object" && phone !== null && typeof desktop === "object") {
          for (const key of Object.keys(phone))
            walk(
              (phone as Record<string, unknown>)[key],
              (desktop as Record<string, unknown>)[key],
              `${path}.${key}`,
            );
        } else paths.push(path);
      };
      walk(catalogueOf(language), catalogueOf(language, "desktop"), "");
      return paths;
    };
    assert.ok(changed("en").length > 0);
    assert.deepEqual(changed("pt-BR"), changed("en"));
  });

  test("the desktop keeps every phrase that has no desktop variant", () => {
    assert.equal(catalogueOf("en", "desktop").tabs.library, "Library");
    assert.equal(catalogueOf("pt-BR", "desktop").library.songCount(2), "2 músicas");
    assert.equal(
      catalogueOf("en", "desktop").playbackText.aboutGenius,
      catalogueOf("en").playbackText.aboutGenius,
    );
  });
});

describe("Portuguese counts at zero", () => {
  const { settings, library, imports } = catalogueOf("pt-BR");

  test("Settings counts read as plurals, never as one", () => {
    assert.equal(settings.minutes(0), "0 minutos");
    assert.equal(settings.minutes(1), "1 minuto");
    assert.equal(settings.foundFiles("0", 0), "0 arquivos encontrados");
    assert.equal(settings.foundFiles("1", 1), "1 arquivo encontrado");
    assert.equal(settings.selected("0", 0), "0 selecionados");
    assert.match(settings.clearPhotos(0), /^Nenhuma foto baixada pelo Wave será apagada\./);
    assert.match(settings.clearPhotos(1), /^A foto que o Wave baixou será apagada\./);
  });

  test("Library counts read as plurals, never as one", () => {
    assert.equal(library.albumCount(0), "0 álbuns");
    assert.equal(library.albumCount(1), "1 álbum");
    assert.equal(library.selected(0), "0 selecionadas");
    assert.deepEqual(
      Object.values(library.kindCounts).map((count) => count(0)),
      ["0 álbuns", "0 artistas", "0 playlists", "0 gêneros", "0 seções", "0 itens"],
    );
    assert.equal(library.kindCounts.artist(1), "1 artista");
  });

  test("an import cut to nothing doesn't say the first song came", () => {
    assert.equal(imports.onlyFirst(0, "Spotify"), "Nenhuma música veio do Spotify");
    assert.equal(imports.onlyFirst(1, "Spotify"), "Só a primeira música veio do Spotify");
  });
});
