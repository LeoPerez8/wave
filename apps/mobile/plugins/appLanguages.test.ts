/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AndroidConfig } from "expo/config-plugins";

import { addAppLanguages, appLanguageFiles } from "./appLanguages.ts";

test("Android offers exactly English and Brazilian Portuguese, with locale changes handled in place", () => {
  const manifest: AndroidConfig.Manifest.AndroidManifest = {
    manifest: {
      $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
      queries: [],
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [
            {
              $: {
                "android:name": ".MainActivity",
                "android:configChanges": "keyboard|keyboardHidden|orientation|screenSize|uiMode",
              },
            },
          ],
        },
      ],
    },
  };
  const result = addAppLanguages(addAppLanguages(manifest));
  const app = result.manifest.application![0]!;
  assert.equal(app.$["android:localeConfig"], "@xml/locales_config");
  assert.deepEqual(app.activity![0]!.$["android:configChanges"]?.split("|"), [
    "keyboard",
    "keyboardHidden",
    "orientation",
    "screenSize",
    "uiMode",
    "locale",
    "layoutDirection",
  ]);
  const xml = appLanguageFiles()["xml/locales_config.xml"]!;
  assert.match(
    xml,
    /<locale-config xmlns:android="http:\/\/schemas.android.com\/apk\/res\/android">/,
  );
  assert.deepEqual(
    [...xml.matchAll(/<locale android:name="([^"]+)"/g)].map((match) => match[1]),
    ["en", "pt-BR"],
  );
});
