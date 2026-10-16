/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { addProfileInstaller, artProfileFiles } from "./artProfiles.ts";

/** The part of prebuild's app/build.gradle that matters here. */
const prebuildAppBuildGradle = `android {
    namespace 'dev.leoperez.wave'
}

dependencies {
    // The version of react-native is set by the React Native Gradle Plugin
    implementation("com.facebook.react:react-android")
}
`;

const profileInstallerLines = (gradle: string): string[] =>
  gradle
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("androidx.profileinstaller"));

describe("addProfileInstaller", () => {
  test("depends on a profileinstaller that installs profiles on Android 15 and later", () => {
    assert.deepEqual(profileInstallerLines(addProfileInstaller(prebuildAppBuildGradle)), [
      'implementation("androidx.profileinstaller:profileinstaller:1.4.1")',
    ]);
  });

  test("adds it once when prebuild runs again on its output", () => {
    const twice = addProfileInstaller(addProfileInstaller(prebuildAppBuildGradle));
    assert.equal(profileInstallerLines(twice).length, 1);
  });

  test("fails prebuild when there is no dependencies block to add it to", () => {
    assert.throws(() => addProfileInstaller("android {\n}\n"), /dependencies \{/);
  });
});

const BASELINE =
  "HSPLdev/leoperez/wave/MainActivity;->onCreate(Landroid/os/Bundle;)V\nLdev/leoperez/wave/MainActivity;\nPLandroidx/media3/session/MediaController;->play()V\n";
const STARTUP =
  "HSPLdev/leoperez/wave/MainActivity;->onCreate(Landroid/os/Bundle;)V\nLdev/leoperez/wave/MainActivity;\n";

const checkedIn =
  (files: Record<string, string>) =>
  (name: string): string | null =>
    files[name] ?? null;

describe("artProfileFiles", () => {
  test("puts Wave's profiles where AGP reads them: baseline for ART, startup for R8's layout", () => {
    assert.deepEqual(
      artProfileFiles(checkedIn({ "baseline-prof.txt": BASELINE, "startup-prof.txt": STARTUP })),
      [
        { path: "app/src/main/baselineProfiles/baseline-prof.txt", contents: BASELINE },
        { path: "app/src/main/baselineProfiles/startup-prof.txt", contents: STARTUP },
      ],
    );
  });

  test("adds nothing before a profile is generated: the APK keeps its libraries' profiles", () => {
    assert.deepEqual(artProfileFiles(checkedIn({})), []);
  });

  test("fails prebuild on a line that isn't a rule, naming it", () => {
    assert.throws(
      () => artProfileFiles(checkedIn({ "baseline-prof.txt": `${BASELINE}<<<<<<< HEAD\n` })),
      /baseline-prof\.txt line 4/,
    );
  });

  test("fails prebuild when the startup profile has rules the baseline lacks", () => {
    assert.throws(
      () =>
        artProfileFiles(checkedIn({ "baseline-prof.txt": STARTUP, "startup-prof.txt": BASELINE })),
      /MediaController/,
    );
  });
});
