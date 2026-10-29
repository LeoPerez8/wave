import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

/**
 * Core runs on the phone under Hermes, which lacks some of what Node has, so
 * the other tests would pass and the app would throw:
 * - the ES2023 copying array methods (`toSorted`, `toReversed`, `toSpliced`);
 * - most of `Intl`. Hermes' doc/IntlAPIs.md (checked 29 Oct 2026, for the
 *   hermes-compiler 260318099.0.4 that React Native 0.88.0-rc.4 ships) lists
 *   only `Collator`, `NumberFormat`, `DateTimeFormat` and
 *   `getCanonicalLocales`, plus the `toLocale*` and `localeCompare` methods.
 *   `PluralRules`, `DisplayNames`, `ListFormat`, `RelativeTimeFormat`,
 *   `Locale`, `Segmenter`, `DurationFormat` and `supportedValuesOf` aren't there.
 * The app has the same guard. Comment lines are skipped, so they can name what's missing.
 */
const MISSING_IN_HERMES =
  /\.(?:toSorted|toReversed|toSpliced)\(|\bIntl\.(?:PluralRules|DisplayNames|ListFormat|RelativeTimeFormat|Locale|Segmenter|DurationFormat|supportedValuesOf)\b/;

const offendingLines = (source: string): number[] =>
  source.split("\n").flatMap((line, index) => {
    const code = line.trim();
    const comment = code.startsWith("//") || code.startsWith("*") || code.startsWith("/*");
    return !comment && MISSING_IN_HERMES.test(line) ? [index + 1] : [];
  });

describe("Core on Hermes", () => {
  test("the guard catches what Hermes lacks, outside comments", () => {
    const source = [
      "const a = list.toSorted(byTitle);",
      "const b = new Intl.PluralRules(language);",
      "const c = new Intl.DisplayNames([language], { type: 'language' });",
      "const d = new Intl.ListFormat(language).format(names);",
      "const e = new Intl.RelativeTimeFormat(language);",
      "const f = new Intl.NumberFormat(language).format(count);",
      "const g = new Intl.DateTimeFormat(language).format(date);",
      "/** Not `Intl.PluralRules`: Hermes lacks it. */",
      "// list.toSorted() isn't there either.",
    ].join("\n");
    assert.deepEqual(offendingLines(source), [1, 2, 3, 4, 5]);
  });

  test("runtime code never calls what Hermes lacks", () => {
    const folder = new URL("./", import.meta.url);
    const offenders = readdirSync(folder)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .flatMap((name) => {
        const lines = readFileSync(new URL(name, folder), "utf8").split("\n");
        return offendingLines(lines.join("\n")).map(
          (line) => `${name}:${line}: ${lines[line - 1]!.trim()}`,
        );
      });
    assert.deepEqual(offenders, []);
  });
});
