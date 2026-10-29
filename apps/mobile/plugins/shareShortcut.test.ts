/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAUNCHER_ICONS } from "@wave/core";
import type { AndroidConfig } from "expo/config-plugins";

import { addLauncherAliases } from "./launcherIcons.ts";
import { addShareShortcuts, shareShortcutFiles, type ManifestEntry } from "./shareShortcut.ts";

type Manifest = AndroidConfig.Manifest.AndroidManifest;

const named = (name: string) => ({ $: { "android:name": name } });

/** The parts of prebuild's manifest that matter here, with app.config.ts's SEND filter. */
const prebuildManifest = (): Manifest => ({
  manifest: {
    $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
    queries: [],
    application: [
      {
        $: { "android:name": ".MainApplication" },
        activity: [
          {
            $: { "android:name": ".MainActivity", "android:launchMode": "singleTask" },
            "intent-filter": [
              {
                action: [named("android.intent.action.MAIN")],
                category: [named("android.intent.category.LAUNCHER")],
              },
              {
                action: [named("android.intent.action.SEND")],
                category: [named("android.intent.category.DEFAULT")],
                data: [{ $: { "android:mimeType": "text/plain" } }],
              },
            ],
          },
        ],
      },
    ],
  },
});

const application = (manifest: Manifest) => manifest.manifest.application![0]!;

/** What `entry`'s shortcuts meta-data points at. */
const shortcutsResources = (entry: ManifestEntry): (string | undefined)[] =>
  (entry["meta-data"] ?? [])
    .filter((m) => m.$["android:name"] === "android.app.shortcuts")
    .map((m) => m.$["android:resource"]);

describe("addShareShortcuts", () => {
  test("every launcher icon points Android at the shortcuts file, whichever one is on", () => {
    const manifest = addShareShortcuts(addLauncherAliases(prebuildManifest()));
    const aliases = application(manifest)["activity-alias"] ?? [];
    assert.equal(aliases.length, LAUNCHER_ICONS.length);
    assert.equal(aliases.length, 625);
    for (const alias of aliases) {
      assert.deepEqual(shortcutsResources(alias), ["@xml/shortcuts"], alias.$?.["android:name"]);
    }
  });

  test("without launcher icons, MainActivity is the launcher entry and points at it", () => {
    const main = application(addShareShortcuts(prebuildManifest())).activity![0]!;
    assert.deepEqual(shortcutsResources(main), ["@xml/shortcuts"]);
  });

  test("running prebuild again doesn't point at it twice", () => {
    const twice = addShareShortcuts(addShareShortcuts(addLauncherAliases(prebuildManifest())));
    for (const alias of application(twice)["activity-alias"] ?? []) {
      assert.equal(shortcutsResources(alias).length, 1);
    }
  });

  test("Wave stays listed in the share sheet for shared text, and only that", () => {
    const main = application(addShareShortcuts(addLauncherAliases(prebuildManifest())))
      .activity![0]!;
    const sends = (main["intent-filter"] ?? []).filter((f) =>
      (f.action ?? []).some((a) => a.$["android:name"] === "android.intent.action.SEND"),
    );
    assert.deepEqual(
      sends.flatMap((f) => (f.data ?? []).map((d) => d.$["android:mimeType"])),
      ["text/plain"],
    );
  });

  test("Quick Settings can bind the Recognize tile, once across repeated prebuilds", () => {
    const manifest = addShareShortcuts(addShareShortcuts(prebuildManifest()));
    const tiles = (application(manifest).service ?? []).filter(
      (service) =>
        service.$["android:name"] === "expo.modules.wavenative.recognize.RecognizeTileService",
    );
    assert.equal(tiles.length, 1);
    assert.equal(tiles[0]!.$["android:permission"], "android.permission.BIND_QUICK_SETTINGS_TILE");
    assert.equal(tiles[0]!.$["android:exported"], "true");
    assert.partialDeepStrictEqual(tiles[0]!.$, {
      "android:label": "@string/recognize_song",
      "android:icon": "@drawable/ic_recognize",
    });
    assert.deepEqual(
      tiles[0]!["intent-filter"]?.flatMap((filter) => filter.action),
      [named("android.service.quicksettings.action.QS_TILE")],
    );
  });
});

describe("shareShortcutFiles", () => {
  const shortcuts = shareShortcutFiles("dev.leoperez.wave")["xml/shortcuts.xml"] ?? "";

  test("declares one share target: shared text, into MainActivity, for the import category", () => {
    const targets = [...shortcuts.matchAll(/<share-target([^>]*)>([\s\S]*?)<\/share-target>/g)];
    assert.equal(targets.length, 1);
    const [, attributes, body] = targets[0]!;
    assert.match(attributes!, /android:targetClass="dev\.leoperez\.wave\.MainActivity"/);
    assert.deepEqual(
      [...body!.matchAll(/<data android:mimeType="([^"]*)"/g)].map(([, type]) => type),
      ["text/plain"],
    );
    assert.deepEqual(
      [...body!.matchAll(/<category android:name="([^"]*)"/g)].map(([, name]) => name),
      ["dev.leoperez.wave.category.IMPORT_SHARED_LINK"],
    );
  });

  test("Recognize Song forwards its action without clearing Wave's existing task", () => {
    const entries = [...shortcuts.matchAll(/<shortcut\s([^>]*?)>([\s\S]*?)<\/shortcut>/g)];
    assert.equal(entries.length, 1);
    assert.match(entries[0]![1]!, /android:shortcutId="recognize_song"/);
    assert.match(entries[0]![1]!, /android:shortcutShortLabel="@string\/recognize_song"/);
    assert.match(entries[0]![2]!, /android:action="dev\.leoperez\.wave\.action\.RECOGNIZE"/);
    assert.match(entries[0]![2]!, /android:targetPackage="dev\.leoperez\.wave"/);
    assert.match(
      entries[0]![2]!,
      /android:targetClass="expo\.modules\.wavenative\.recognize\.RecognizeShortcutActivity"/,
    );
    const manifest = addShareShortcuts(addShareShortcuts(prebuildManifest()));
    const forwarders = application(manifest).activity!.filter(
      (activity) =>
        activity.$["android:name"] ===
        "expo.modules.wavenative.recognize.RecognizeShortcutActivity",
    );
    assert.equal(forwarders.length, 1);
    assert.partialDeepStrictEqual(forwarders[0]!.$, {
      "android:taskAffinity": "",
      "android:theme": "@android:style/Theme.NoDisplay",
      "android:exported": "true",
      "android:excludeFromRecents": "true",
      "android:noHistory": "true",
    });
    assert.match(
      shareShortcutFiles("dev.leoperez.wave")["values/recognize.xml"]!,
      />Recognize Song</,
    );
  });

  test("the app icon shortcut shows its mic on a coloured ground; the tile keeps the white glyph Android tints", () => {
    const files = shareShortcutFiles("dev.leoperez.wave");
    /** The file a `@type/name` reference resolves to, whatever its qualifiers. */
    const resource = (reference: string): string => {
      const [, type, name] = /^@(\w+)\/(\w+)$/.exec(reference) ?? [];
      const path = Object.keys(files).find((p) => new RegExp(`^${type}(-[^/]*)?/${name}\\.xml$`).test(p));
      assert.ok(path, `no file for ${reference}`);
      return files[path]!;
    };
    const shortcutIcon = /<shortcut\s[^>]*android:icon="([^"]*)"/.exec(shortcuts)?.[1] ?? "";
    const tile = (application(addShareShortcuts(prebuildManifest())).service ?? []).find(
      (service) =>
        service.$["android:name"] === "expo.modules.wavenative.recognize.RecognizeTileService",
    );
    // Expo omits service icons from its manifest attribute type.
    const tileIcon = (tile?.$ as Record<string, string> | undefined)?.["android:icon"] ?? "";
    assert.notEqual(shortcutIcon, tileIcon);

    const adaptive = resource(shortcutIcon);
    assert.match(adaptive, /<adaptive-icon/);
    const background = /<background android:drawable="@color\/(\w+)"/.exec(adaptive)?.[1];
    const colour = new RegExp(`<color name="${background}">(#[0-9A-Fa-f]{6})</color>`).exec(
      files["values/recognize.xml"]!,
    )?.[1];
    assert.ok(colour, "the background is a colour resource");
    assert.notEqual(colour.toUpperCase(), "#FFFFFF");
    const foreground = /<foreground android:drawable="([^"]*)"/.exec(adaptive)?.[1] ?? "";
    assert.match(resource(foreground), /android:fillColor="#FFFFFFFF"/);
    assert.match(resource(foreground), /android:viewportWidth="108"/);
    assert.match(resource(tileIcon), /android:fillColor="#FFFFFFFF"/);
  });
});
