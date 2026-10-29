import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { findUntranslatedText } from "./untranslated-text.mjs";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/untranslated-text/${name}.txt`, import.meta.url), "utf8");

test("reports literal Text children, accessibility text and interpolated toasts with locations", () => {
  assert.deepEqual(
    findUntranslatedText("apps/mobile/src/example.tsx", fixture("visible.tsx")).map(
      ({ line, text }) => [line, text],
    ),
    [
      [1, "Play song"],
      [1, "Recently played"],
      [2, "Added ${count} songs"],
    ],
  );
});

test("ignores catalogue reads, brands, symbols, logs, errors, tests and explicit private tools", () => {
  assert.deepEqual(
    findUntranslatedText("apps/mobile/src/example.tsx", fixture("excluded.tsx")),
    [],
  );
  for (const file of [
    "apps/mobile/src/app/settings/developer.tsx",
    "apps/mobile/src/app/design-preview.tsx",
    "apps/mobile/src/app/dev/glass.tsx",
    "apps/mobile/src/dev/glass/FrameStatsHud.tsx",
    "apps/mobile/src/perf/PerfProbe.tsx",
    "apps/mobile/src/preview/KindCards.tsx",
    "apps/mobile/src/library/db/testDatabase.ts",
    "apps/mobile/src/example.test.tsx",
    "packages/core/src/catalogueEn.ts",
    "packages/core/src/cataloguePtBr.ts",
    "packages/core/src/catalogue/homePtBr.ts",
  ])
    assert.deepEqual(findUntranslatedText(file, fixture("visible.tsx")), []);
  assert.equal(
    findUntranslatedText("apps/mobile/src/glass/Glass.tsx", fixture("visible.tsx")).length,
    3,
  );
});

test("finds Core's returned visible English without treating enum ids as copy", () => {
  assert.deepEqual(
    findUntranslatedText("packages/core/src/example.ts", fixture("core.ts")).map(
      ({ text }) => text,
    ),
    ["${count} songs", "Couldn't download the song", "Play", "Add to Queue"],
  );
});

test("report mode lists findings per file; strict mode rejects the same findings", async () => {
  const { textReport, checkTextFindings } = await import("./untranslated-text-report.ts");
  const findings = findUntranslatedText("apps/mobile/src/example.tsx", fixture("visible.tsx"));
  assert.match(textReport(findings), /example.tsx \(3\)/);
  assert.match(textReport(findings), /Untranslated text: 3 finding\(s\) in 1 file\(s\)/);
  assert.doesNotThrow(() => checkTextFindings(findings, false));
  assert.throws(() => checkTextFindings(findings, true), /Literal UI text remains/);
  assert.doesNotThrow(() => checkTextFindings([], true));
});

test("handles JSX expressions, conditional labels, multiline alerts and confirm actions", () => {
  const source = [
    '<BodyText>{count === 1 ? "One song" : `${count} songs`}</BodyText>;',
    '<Input title="Search" label={ready ? "Ready" : strings.wait} placeholder="Find songs" message="Try again" accessibilityHint="Double tap to play" />;',
    'Alert.alert("Delete song?", "This cannot be undone", [{ text: "Delete" }]);',
    'confirm({ title: "Remove songs?", action: { label: "Remove" } });',
    'void showMessage("Couldn\'t remove the songs", cause.message);',
  ].join("\n");
  assert.deepEqual(
    findUntranslatedText("apps/mobile/src/example.tsx", source).map(({ text }) => text),
    [
      "One song",
      "${count} songs",
      "Search",
      "Ready",
      "Find songs",
      "Try again",
      "Double tap to play",
      "Delete song?",
      "This cannot be undone",
      "Delete",
      "Remove songs?",
      "Remove",
      "Couldn't remove the songs",
    ],
  );
});

test("Core enum values, URLs and private diagnostic builders are not UI copy", () => {
  assert.deepEqual(
    findUntranslatedText(
      "packages/core/src/example.ts",
      [
        'export const cause = () => "queueTap";',
        "export const url = () => `https://api.genius.com/search?q=${title}`;",
        "export const key = () => `blackplayer:${ordinal}:${key}`;",
      ].join("\n"),
    ),
    [],
  );
  assert.deepEqual(findUntranslatedText("packages/core/src/appLog.ts", fixture("core.ts")), []);
});

test("a marked declaration or property is not UI copy; the marker needs a reason", () => {
  const source = [
    "// not UI text: the app log's line",
    "export const fillLine = (n: number) => `The fill pauses for ${n} s`;",
    "export const sizes = {",
    "  // not UI text: a stored field kind",
    '  title: "text",',
    '  label: "Visible label",',
    "};",
    "// not UI text:",
    'export const shown = () => "Still visible";',
  ].join("\n");
  assert.deepEqual(
    findUntranslatedText("packages/core/src/example.ts", source).map(({ text }) => text),
    ["Visible label", "Still visible"],
  );
});
