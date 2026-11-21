import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { earlierEntries, skippedReleases } from "./skipped-releases.ts";

describe("skippedReleases", () => {
  const tags = [
    "latest",
    "ti-latest",
    "v0.70.0-ti",
    "v0.71.0-ti",
    "v0.72.0-ti",
    "v0.73.0-ti",
    "v0.74.0-ti",
    "v0.75.0-ti",
    "v0.76.0-ti",
    "v0.77.0-ti",
    "v0.71.0",
  ];
  // GitHub's releases, each holding the phone's APK.
  const withApk = (...tags: string[]) =>
    tags.map((tag) => ({ tagName: tag, assets: [`wave-${tag.slice(1)}.apk`] }));
  const published = withApk("v0.71.0-ti", "v0.72.0-ti", "v0.74.0-ti", "v0.71.0");

  it("lists the channel's tags with no release before the commit's, oldest first", () => {
    assert.deepEqual(skippedReleases({ channel: "ti", tags, own: ["v0.77.0-ti"], published }), [
      "v0.70.0-ti",
      "v0.73.0-ti",
      "v0.75.0-ti",
      "v0.76.0-ti",
    ]);
  });

  it("leaves out the commit's own tag, and every tag a release was published on", () => {
    const all = [...published, ...withApk("v0.73.0-ti", "v0.75.0-ti", "v0.76.0-ti", "v0.70.0-ti")];
    assert.deepEqual(
      skippedReleases({ channel: "ti", tags, own: ["v0.77.0-ti"], published: all }),
      [],
    );
  });

  it("keeps each channel to its own tags", () => {
    const stable = ["v0.70.0", "v0.71.0", "v0.72.0-ti", "v0.72.0"];
    assert.deepEqual(
      skippedReleases({
        channel: "main",
        tags: stable,
        own: ["v0.72.0"],
        published: withApk("v0.70.0"),
      }),
      ["v0.71.0"],
    );
  });

  it("counts a version whose release holds only the desktop's files as skipped for the phone", () => {
    const desktopOnly = [
      ...published,
      {
        tagName: "v0.73.0-ti",
        assets: ["wave-0.73.0-ti-win-x64.exe", "wave-0.73.0-ti-linux-x64.AppImage"],
      },
      { tagName: "v0.75.0-ti", assets: ["wave-0.75.0-ti.apk", "wave-0.75.0-ti-win-x64.exe"] },
    ];
    assert.deepEqual(
      skippedReleases({ channel: "ti", tags, own: ["v0.77.0-ti"], published: desktopOnly }),
      ["v0.70.0-ti", "v0.73.0-ti", "v0.76.0-ti"],
    );
  });

  it("looks only as far back as the channel's newest tags before the commit's", () => {
    assert.deepEqual(
      skippedReleases({ channel: "ti", tags, own: ["v0.77.0-ti"], published, within: 4 }),
      ["v0.73.0-ti", "v0.75.0-ti", "v0.76.0-ti"],
    );
  });

  it("orders versions by number, not as text", () => {
    assert.deepEqual(
      skippedReleases({
        channel: "ti",
        tags: ["v0.10.0-ti", "v0.9.0-ti", "v0.11.0-ti"],
        own: ["v0.11.0-ti"],
        published: [],
      }),
      ["v0.9.0-ti", "v0.10.0-ti"],
    );
  });
});

describe("earlierEntries", () => {
  it("gives each version its notes and its date in UTC", () => {
    const notes = {
      en: { new: ["A line"], fixes: [] },
      "pt-BR": { new: ["Uma linha"], fixes: [] },
    };
    const files: Record<string, string> = { "a.json": JSON.stringify(notes) };
    assert.deepEqual(
      earlierEntries(["0.73.0-ti", "2026-11-20T21:00:00-03:00", "a.json"], (f) => files[f] ?? ""),
      [{ version: "0.73.0-ti", date: "2026-11-21T00:00:00.000Z", notes }],
    );
  });

  it("is none for no version", () => {
    assert.deepEqual(
      earlierEntries([], () => ""),
      [],
    );
  });
});
