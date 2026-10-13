/// <reference types="node" />
// The splash's moving logo is an AnimatedVectorDrawable Android plays before
// Wave's code runs. The config plugin writes it from Core's `launchLogoWaves`;
// this checks the drawable says what Core does.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LAUNCH_LOGO, launchLogoWaves, type LogoWave } from "@wave/core";

import { launchLogoAttrs, launchLogoDrawable } from "../../plugins/launchLogoDrawable.ts";

const xml = launchLogoDrawable();
const waves = launchLogoWaves();

/** The attributes of the first `<tag …>` whose attributes include `where`. */
const element = (tag: string, where: string): Record<string, string> => {
  const found = [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].find((match) =>
    match[1]!.includes(where),
  );
  assert.ok(found, `a <${tag}> with ${where}`);
  return Object.fromEntries(
    [...found[1]!.matchAll(/android:(\w+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]),
  );
};

/** The animators of one target, in order, with the interpolator path each carries. */
const animators = (target: string): Record<string, string | undefined>[] => {
  const start = xml.indexOf(`<target android:name="${target}">`);
  assert.ok(start >= 0, `a target for ${target}`);
  const body = xml.slice(start, xml.indexOf("</target>", start));
  return [
    ...body.matchAll(/<objectAnimator\b([^>]*?)\/?>([\s\S]*?(?=<objectAnimator|<\/set>|$))/g),
  ].map((match) => ({
    ...Object.fromEntries(
      [...match[1]!.matchAll(/android:(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]),
    ),
    curve: /<pathInterpolator android:pathData="([^"]*)"/.exec(match[2] ?? "")?.[1],
  }));
};

describe("launch_logo.xml", () => {
  test("is the splash icon's square", () => {
    const vector = element("vector", "viewportWidth");
    assert.equal(vector.width, `${LAUNCH_LOGO.size}dp`);
    assert.equal(vector.height, `${LAUNCH_LOGO.size}dp`);
    assert.equal(vector.viewportWidth, String(LAUNCH_LOGO.size));
    assert.equal(vector.viewportHeight, String(LAUNCH_LOGO.size));
  });

  for (const [wave, attr] of [
    ["top", "waveLaunchPrimary"],
    ["bottom", "waveLaunchSecondary"],
  ] as const satisfies [LogoWave, string][]) {
    test(`draws Core's ${wave} wave in the splash theme's ${attr}, still logo first`, () => {
      const path = element("path", `android:name="${wave}"`);
      assert.equal(path.pathData, waves[wave].path);
      assert.equal(path.strokeColor, `?attr/${attr}`);
      assert.equal(Number(path.strokeWidth).toFixed(2), waves[wave].stroke.toFixed(2));
      assert.equal(path.strokeLineCap, "round");
      assert.equal(Number(path.trimPathStart), waves[wave].trimStart.from);
      assert.equal(Number(path.trimPathEnd), waves[wave].trimEnd.from);
    });

    test(`slides the ${wave} wave a wavelength left per sweep, forever`, () => {
      const [slide] = animators(`${wave}_slide`);
      assert.equal(slide?.propertyName, "translateX");
      assert.equal(Number(slide?.valueFrom), 0);
      assert.equal(Number(slide?.valueTo).toFixed(2), (-waves[wave].slide).toFixed(2));
      assert.equal(slide?.interpolator, "@android:anim/linear_interpolator");
      assert.equal(Number(slide?.duration), LAUNCH_LOGO.cycleMs);
      assert.equal(slide?.repeatCount, "infinite");
      assert.equal(slide?.repeatMode, "restart");
    });

    test(`trims the ${wave} wave at Core's pace so its caps stay put`, () => {
      const [start, end] = animators(wave);
      for (const [animator, property, trim] of [
        [start, "trimPathStart", waves[wave].trimStart],
        [end, "trimPathEnd", waves[wave].trimEnd],
      ] as const) {
        assert.equal(animator?.propertyName, property);
        assert.equal(Number(animator?.valueFrom), trim.from);
        assert.equal(Number(animator?.valueTo), trim.to);
        assert.equal(animator?.curve, trim.curve);
        assert.equal(Number(animator?.duration), LAUNCH_LOGO.cycleMs);
        assert.equal(animator?.repeatCount, "infinite");
        assert.equal(animator?.repeatMode, "restart");
      }
    });
  }

  test("declares the theme attributes the waves take their colours from", () => {
    const attrs = launchLogoAttrs();
    assert.match(attrs, /<attr name="waveLaunchPrimary" format="color" \/>/);
    assert.match(attrs, /<attr name="waveLaunchSecondary" format="color" \/>/);
  });
});
