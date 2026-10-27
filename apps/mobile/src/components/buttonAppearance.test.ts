import assert from "node:assert/strict";
import { test } from "node:test";
import {
  iconButtonAppearance,
  textButtonAppearance,
  runPlainButtonPress,
} from "./buttonAppearance.ts";

test("icon defaults keep the 48dp accent target and disabled tertiary glyph", () => {
  assert.deepEqual(iconButtonAppearance(), {
    color: "accent",
    size: 48,
    iconSize: 24,
    strokeWidth: 1.5,
    haptic: "selection",
    depth: 0.1,
  });
  assert.equal(iconButtonAppearance({ disabled: true }).color, "tertiary");
});

test("transport and glass controls keep their ink, target, stroke and impact feedback", () => {
  assert.deepEqual(
    iconButtonAppearance({ tone: "primary", size: 72, iconSize: 48, haptic: "impact" }),
    {
      color: "foreground",
      size: 72,
      iconSize: 48,
      strokeWidth: 1.5,
      haptic: "impact",
      depth: 0.1,
    },
  );
  assert.equal(iconButtonAppearance({ tone: "on-glass" }).color, "foreground");
  assert.equal(iconButtonAppearance({ tone: "destructive" }).color, "destructive");
  assert.equal(
    iconButtonAppearance({ tone: "secondary", disabled: true, disabledTone: "secondary" }).color,
    "secondary",
  );
});

test("plain list actions dim without animation and disabled actions use secondary ink", () => {
  assert.deepEqual(textButtonAppearance({ variant: "plain", pressed: true }), {
    color: "accent",
    background: null,
    animated: false,
    opacity: 0.4,
  });
  assert.equal(textButtonAppearance({ disabled: true }).color, "secondary");
});

test("choice pills and period segments keep their selected ink and fill", () => {
  assert.equal(textButtonAppearance({ variant: "pill", selected: true }).background, "accent");
  assert.equal(textButtonAppearance({ variant: "pill", selected: true }).color, "on-accent");
  assert.equal(textButtonAppearance({ variant: "pill" }).background, "fill");
  assert.equal(textButtonAppearance({ variant: "segment", selected: true }).color, "foreground");
  assert.equal(textButtonAppearance({ variant: "segment" }).color, "secondary");
});

test("plain buttons suppress both feedback and actions when disabled", () => {
  const calls: string[] = [];
  runPlainButtonPress(
    { disabled: true },
    () => calls.push("pressed"),
    (kind) => calls.push(kind),
  );
  assert.equal(calls.length, 0);
  runPlainButtonPress(
    {},
    () => calls.push("pressed"),
    (kind) => calls.push(kind),
  );
  assert.deepEqual(calls, ["selection", "pressed"]);
  calls.length = 0;
  runPlainButtonPress(
    { haptic: "impact" },
    () => calls.push("pressed"),
    (kind) => calls.push(kind),
  );
  assert.deepEqual(calls, ["impact", "pressed"]);
});

test("the Now Playing star keeps its highlight even while its target is disabled", () => {
  assert.equal(iconButtonAppearance({ tone: "highlight" }).color, "highlight");
  assert.equal(
    iconButtonAppearance({ tone: "highlight", disabled: true, disabledTone: "highlight" }).color,
    "highlight",
  );
});
