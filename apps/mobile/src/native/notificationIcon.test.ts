/// <reference types="node" />
// The media notification's small icon (`wave_notification.xml`, issue #102) is a
// native vector drawable, so it can't import Core. This fails when it drifts from
// Core's logo (`logoIconPaths`), the single source the launcher icons and splash
// logos are rendered from too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { logoIconPaths } from "@wave/core";

const xml = readFileSync(
  new URL(
    "../../modules/wave-native/android/src/main/res/drawable/wave_notification.xml",
    import.meta.url,
  ),
  "utf8",
);

/** Every value of `android:<name>`, in document order. */
const values = (name: string): string[] =>
  [...xml.matchAll(new RegExp(`android:${name}="([^"]*)"`, "g"))].map((match) => match[1]!);

describe("wave_notification.xml", () => {
  // Android's status bar icon: 24dp, with the logo's caps 1dp in from each side.
  const logo = logoIconPaths({ size: 24, inset: 1 });

  test("is a 24dp square", () => {
    assert.deepEqual(values("width"), ["24dp"]);
    assert.deepEqual(values("height"), ["24dp"]);
    assert.deepEqual(values("viewportWidth"), ["24"]);
    assert.deepEqual(values("viewportHeight"), ["24"]);
  });

  test("strokes Core's two waves, top then bottom, with round caps", () => {
    assert.deepEqual(values("pathData"), [logo.top, logo.bottom]);
    assert.deepEqual(values("strokeWidth").map(Number), [logo.stroke, logo.stroke]);
    assert.deepEqual(values("strokeLineCap"), ["round", "round"]);
  });

  test("is opaque white with no fill, since the system only keeps the alpha", () => {
    assert.deepEqual(values("strokeColor"), ["#FFFFFFFF", "#FFFFFFFF"]);
    assert.deepEqual(values("fillColor"), []);
  });
});
