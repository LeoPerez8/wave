/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAUNCHER_ICON_ART, LAUNCHER_ICONS } from "@wave/core";
import type { AndroidConfig } from "expo/config-plugins";

import { addLauncherAliases, launcherIconFiles } from "./launcherIcons.ts";

type Manifest = AndroidConfig.Manifest.AndroidManifest;

const action = (name: string) => ({ $: { "android:name": name } });

/** The parts of prebuild's manifest that matter here. */
const prebuildManifest = (): Manifest => ({
  manifest: {
    $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
    queries: [],
    application: [
      {
        $: { "android:name": ".MainApplication", "android:icon": "@mipmap/ic_launcher" },
        activity: [
          {
            $: { "android:name": ".MainActivity", "android:launchMode": "singleTask" },
            "intent-filter": [
              {
                action: [action("android.intent.action.MAIN")],
                category: [action("android.intent.category.LAUNCHER")],
              },
              {
                action: [action("android.intent.action.VIEW")],
                category: [action("android.intent.category.DEFAULT")],
                data: [{ $: { "android:scheme": "wave" } }],
              },
            ],
          },
        ],
      },
    ],
  },
});

const application = (manifest: Manifest) => manifest.manifest.application![0]!;

const isLauncher = (filter: { category?: { $: { "android:name": string } }[] }): boolean =>
  filter.category?.some((c) => c.$["android:name"] === "android.intent.category.LAUNCHER") === true;

describe("addLauncherAliases", () => {
  test("MainActivity leaves the app drawer to the icons but keeps its deep links", () => {
    const main = application(addLauncherAliases(prebuildManifest())).activity![0]!;
    const filters = main["intent-filter"] ?? [];
    assert.equal(filters.filter(isLauncher).length, 0);
    assert.equal(filters.length, 1);
    assert.equal(filters[0]?.data?.[0]?.$["android:scheme"], "wave");
  });

  test("every icon is a launcher entry that opens MainActivity with its own icon", () => {
    const aliases = application(addLauncherAliases(prebuildManifest()))["activity-alias"] ?? [];
    assert.equal(aliases.length, LAUNCHER_ICONS.length);
    for (const icon of LAUNCHER_ICONS) {
      const alias = aliases.find((a) => a.$?.["android:name"] === `.LauncherIcon_${icon.id}`);
      assert.ok(alias, icon.id);
      assert.equal(alias.$?.["android:targetActivity"], ".MainActivity");
      assert.equal(alias.$?.["android:icon"], `@mipmap/ic_launcher_${icon.id}`);
      assert.equal(alias.$?.["android:exported"], "true");
      assert.ok((alias["intent-filter"] ?? []).some(isLauncher));
    }
  });

  test("only the teal-over-amber icon is on until Settings picks another, so Wave shows once", () => {
    const aliases = application(addLauncherAliases(prebuildManifest()))["activity-alias"] ?? [];
    const on = aliases.filter((alias) => alias.$?.["android:enabled"] === "true");
    assert.deepEqual(
      on.map((alias) => alias.$?.["android:name"]),
      [".LauncherIcon_teal_ember"],
    );
  });

  test("running prebuild again doesn't add the icons twice", () => {
    const twice = addLauncherAliases(addLauncherAliases(prebuildManifest()));
    assert.equal(application(twice)["activity-alias"]?.length, LAUNCHER_ICONS.length);
  });
});

describe("launcherIconFiles", () => {
  const files = launcherIconFiles();

  test("each icon is an adaptive icon: its waves on black, with the monochrome waves", () => {
    for (const icon of LAUNCHER_ICONS) {
      const adaptive = files[`mipmap-anydpi-v26/ic_launcher_${icon.id}.xml`];
      assert.ok(adaptive, icon.id);
      assert.match(adaptive, /<background android:drawable="@android:color\/black"\s*\/>/);
      assert.match(
        adaptive,
        new RegExp(`<foreground android:drawable="@drawable/ic_launcher_${icon.id}_foreground"`),
      );
      assert.match(
        adaptive,
        /<monochrome android:drawable="@drawable\/ic_launcher_wave_monochrome"/,
      );
    }
  });

  test("a foreground strokes the top wave in the primary and the bottom wave in the secondary", () => {
    const foreground = files["drawable/ic_launcher_blue_coral_foreground.xml"] ?? "";
    const paths = [...foreground.matchAll(/<path([^>]*)\/>/g)].map(([, attributes]) => attributes!);
    assert.equal(paths.length, 2);
    assert.match(paths[0]!, /android:strokeColor="#7aaef5"/);
    assert.ok(paths[0]!.includes(`android:pathData="${LAUNCHER_ICON_ART.top}"`));
    assert.match(paths[1]!, /android:strokeColor="#f5917e"/);
    assert.ok(paths[1]!.includes(`android:pathData="${LAUNCHER_ICON_ART.bottom}"`));
    for (const path of paths) {
      assert.match(path, /android:strokeLineCap="round"/);
      assert.match(path, new RegExp(`android:strokeWidth="${LAUNCHER_ICON_ART.strokeWidth}"`));
    }
    assert.match(foreground, /android:viewportWidth="108"/);
  });

  test("the monochrome icon is the same two waves", () => {
    const monochrome = files["drawable/ic_launcher_wave_monochrome.xml"] ?? "";
    assert.ok(monochrome.includes(LAUNCHER_ICON_ART.top));
    assert.ok(monochrome.includes(LAUNCHER_ICON_ART.bottom));
  });
});
