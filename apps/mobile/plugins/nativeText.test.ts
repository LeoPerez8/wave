/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nativeCatalogueKotlin, nativeTextResources } from "./nativeText.ts";

test("native defaults stay in sync with the typed catalogue", () => {
  assert.equal(
    readFileSync(
      new URL(
        "../modules/wave-native/android/src/main/java/expo/modules/wavenative/locale/NativeCatalogue.kt",
        import.meta.url,
      ),
      "utf8",
    ),
    nativeCatalogueKotlin(),
  );
});

test("prebuild supplies Portuguese shortcut and notification resources and English defaults", () => {
  const files = nativeTextResources();
  assert.match(files["values-pt/wave_text.xml"]!, />Reconhecer Música</);
  assert.match(files["values-pt/wave_text.xml"]!, />Importar para o Wave</);
  assert.match(files["values-pt/wave_text.xml"]!, />Salvando na Biblioteca</);
  assert.match(files["values/wave_text.xml"]!, />Import to Wave</);
});
