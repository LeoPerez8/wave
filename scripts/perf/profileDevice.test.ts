import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatProfile } from "./artProfile.ts";
import { FakeDevice } from "./fakeDevice.ts";
import {
  compileWithBaseline,
  generateProfiles,
  readProfileState,
  type GenerateOptions,
} from "./profileDevice.ts";

const PKG = "dev.leoperez.wave";

const options = (overrides: Partial<GenerateOptions> = {}): GenerateOptions => ({
  package: PKG,
  tabs: ["Home", "Library", "Playlists"],
  launchSettleMs: 6_000,
  settleMs: 1_200,
  startupLaunches: 3,
  journeyIterations: 2,
  log: () => {},
  ...overrides,
});

describe("generateProfiles on the simulated phone", () => {
  it("takes the startup profile from launches alone and the baseline from the whole journey", async () => {
    const { startup, baseline, missed } = await generateProfiles(new FakeDevice(), options());
    assert.deepEqual(missed, []);
    const startupText = formatProfile(startup);
    const baselineText = formatProfile(baseline);
    // Launching runs MainActivity; only the journey opens Now Playing (Media3) and a Track list.
    assert.match(startupText, /dev\/leoperez\/wave\/MainActivity;->onCreate/);
    assert.doesNotMatch(startupText, /androidx\/media3/);
    assert.match(baselineText, /androidx\/media3/);
    assert.match(baselineText, /ReactScrollView/);
    // The baseline holds the startup profile too: AGP reads them as separate files.
    for (const line of startupText.split("\n").filter(Boolean))
      assert.ok(baselineText.includes(line), `${line} is in the baseline`);
  });

  it("starts from a cleared profile, without the APK's own baseline", async () => {
    const phone = new FakeDevice({ savedProfile: ["Lcom/example/Stale;"] });
    const { baseline } = await generateProfiles(phone, options());
    const text = formatProfile(baseline);
    assert.doesNotMatch(text, /Stale/);
    // The simulated APK ships an AndroidX profile; profileinstaller must not install it.
    assert.doesNotMatch(text, /androidx\/appcompat/);
  });

  it("names the journey's targets it couldn't find, and goes on", async () => {
    const { missed, baseline } = await generateProfiles(
      new FakeDevice(),
      options({ tabs: ["Home", "Library", "Nope"] }),
    );
    assert.deepEqual(missed, ['{"desc":"Nope"}']);
    assert.match(formatProfile(baseline), /androidx\/media3/);
  });

  it("refuses a phone older than Android 13, where a profile can't be read without root", async () => {
    await assert.rejects(generateProfiles(new FakeDevice({ sdk: 32 }), options()), /Android 13/);
  });
});

describe("compileWithBaseline", () => {
  it("compiles the APK with only its shipped profile, the state a fresh install reaches", async () => {
    const phone = new FakeDevice({ savedProfile: ["Lcom/example/Stale;"] });
    const result = await compileWithBaseline(phone, PKG);
    assert.equal(result.install, "INSTALL_SUCCESS");
    const state = await readProfileState(phone, PKG);
    assert.deepEqual(state.compilation, { status: "speed-profile", reason: "cmdline" });
    assert.ok(state.profile !== null);
    const text = formatProfile(state.profile);
    assert.match(text, /androidx\/appcompat/);
    assert.doesNotMatch(text, /Stale/);
  });

  // profileinstaller 1.3.1 on Android 15+: what a sideload of such an APK gets is no profile.
  it("says when profileinstaller can't install the profile, and compiles with none", async () => {
    const phone = new FakeDevice({ installResult: 3, savedProfile: ["Lcom/example/Stale;"] });
    const result = await compileWithBaseline(phone, PKG);
    assert.equal(result.install, "UNSUPPORTED_ART_VERSION");
    const state = await readProfileState(phone, PKG);
    assert.equal(state.profile, null);
  });
});
