import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { findUntranslatedText, isTextSource, type TextFinding } from "./untranslated-text.mjs";

/** On since Portuguese launched (#789): any finding fails the app and Core tests. */
export const STRICT_UNTRANSLATED_TEXT = true;
const root = new URL("../../", import.meta.url);

export function collectTextFindings(scope: string, path = ""): TextFinding[] {
  const folder = new URL(`${scope}/`, root);
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .map((name) => `${scope}/${name.replaceAll("\\", "/")}`)
    .filter((file) => isTextSource(file) && file.startsWith(path))
    .toSorted()
    .flatMap((file) => findUntranslatedText(file, readFileSync(new URL(file, root), "utf8")));
}

export function textReport(findings: readonly TextFinding[]): string {
  const groups = new Map<string, TextFinding[]>();
  for (const finding of findings) {
    const group = groups.get(finding.file) ?? [];
    group.push(finding);
    groups.set(finding.file, group);
  }
  return [...groups]
    .flatMap(([file, rows]) => [
      `${file} (${rows.length})`,
      ...rows.map(({ line, column, text }) => `  ${line}:${column}: ${text}`),
    ])
    .concat(`Untranslated text: ${findings.length} finding(s) in ${groups.size} file(s).`)
    .join("\n");
}

export function checkTextFindings(findings: readonly TextFinding[], strict: boolean): void {
  if (strict)
    assert.equal(
      findings.length,
      0,
      "Literal UI text remains; move it into both catalogues.\n" + textReport(findings),
    );
}

export function runTextGuard(scope: string): void {
  // Filtering limits the report only. Strict CI always checks the whole scope.
  const strict = STRICT_UNTRANSLATED_TEXT || process.env.TEXT_CHECK_STRICT === "1";
  const findings = collectTextFindings(scope, strict ? "" : process.env.TEXT_CHECK_PATH);
  console.log(textReport(findings));
  checkTextFindings(findings, strict);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runTextGuard("apps/mobile/src");
  runTextGuard("packages/core/src");
}
