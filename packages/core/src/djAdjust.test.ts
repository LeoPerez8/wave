import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  DEFAULT_DJ_SETTINGS,
  djAdjustGroups,
  djAdjustSheetHeight,
  djAdjustSheetSwipeCloses,
  type DjSettings,
} from "./index.ts";

/** Each group as the sheet draws it: its name, its options (the chosen one marked) and its note. */
const drawn = (settings: DjSettings, locale: "en" | "pt-BR" = "en") =>
  djAdjustGroups(settings, catalogueOf(locale)).map((group) => ({
    name: group.name,
    options: group.options.map((option) => (option.selected ? `[${option.label}]` : option.label)),
    note: group.note,
  }));

describe("Adjust's option groups", () => {
  test("show Artist variety then Music discovery, three options each, the defaults chosen", () => {
    assert.deepEqual(drawn(DEFAULT_DJ_SETTINGS), [
      {
        name: "Artist variety",
        options: ["Low", "[Medium]", "High"],
        note: "The artists you picked and those close to them.",
      },
      {
        name: "Music discovery",
        options: ["Familiar", "[Blend]", "Discover"],
        note: "60% of the songs are new to you.",
      },
    ]);
  });

  test("mark the chosen option and follow it with that option's note", () => {
    const settings = { ...DEFAULT_DJ_SETTINGS, variety: "high", discovery: "discover" } as const;
    assert.deepEqual(drawn(settings), [
      {
        name: "Artist variety",
        options: ["Low", "Medium", "[High]"],
        note: "A wider circle of artists, each showing up less often.",
      },
      {
        name: "Music discovery",
        options: ["Familiar", "Blend", "[Discover]"],
        note: "100% of the songs are new to you.",
      },
    ]);
  });

  test("an option holds the choices a tap on it makes, the others kept", () => {
    const settings: DjSettings = {
      ...DEFAULT_DJ_SETTINGS,
      popularity: "trending",
      mood: ["relaxing"],
    };
    const [variety, discovery] = djAdjustGroups(settings);
    assert.deepEqual(variety!.options[0]!.settings, { ...settings, variety: "low" });
    assert.deepEqual(discovery!.options[0]!.settings, { ...settings, discovery: "familiar" });
  });

  test("are in Brazilian Portuguese too", () => {
    assert.deepEqual(drawn({ ...DEFAULT_DJ_SETTINGS, discovery: "familiar" }, "pt-BR"), [
      {
        name: "Variedade de artistas",
        options: ["Baixa", "[Média]", "Alta"],
        note: "Os artistas que você escolheu e os próximos deles.",
      },
      {
        name: "Descoberta de música",
        options: ["[Conhecidas]", "Misturar", "Descobrir"],
        note: "20% das músicas são novas para você.",
      },
    ]);
  });
});

describe("Adjust's sheet", () => {
  test("is at most about 85% of the screen", () => {
    assert.equal(djAdjustSheetHeight({ window: 800, top: 24, bottom: 16 }), 680);
  });

  test("stays clear of the status bar on a short screen", () => {
    // 85% of 400 is 340, but only 400 − 120 − 16 − 2 cells is left under the status bar.
    assert.equal(djAdjustSheetHeight({ window: 400, top: 120, bottom: 16 }), 248);
  });

  test("a drag down a third of its height closes it, however slowly it ends", () => {
    assert.equal(djAdjustSheetSwipeCloses({ translationY: 200, velocityY: 0, height: 600 }), true);
  });

  test("a short, slow drag down springs back", () => {
    assert.equal(
      djAdjustSheetSwipeCloses({ translationY: 120, velocityY: 50, height: 600 }),
      false,
    );
  });

  test("a quick flick down closes it", () => {
    assert.equal(djAdjustSheetSwipeCloses({ translationY: 40, velocityY: 900, height: 600 }), true);
  });

  test("a flick back up cancels a long drag down", () => {
    assert.equal(
      djAdjustSheetSwipeCloses({ translationY: 300, velocityY: -900, height: 600 }),
      false,
    );
  });

  test("a drag up never closes it", () => {
    assert.equal(
      djAdjustSheetSwipeCloses({ translationY: -300, velocityY: -900, height: 600 }),
      false,
    );
  });
});
