import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// The workspace compiler is TypeScript 7; react-doctor carries the stable
// TypeScript 5 parser API, also used by themeLookups.test.ts.
const ts = createRequire(require.resolve("react-doctor"))("typescript");

const UI_PROPERTIES = new Set([
  "accessibilityLabel",
  "accessibilityHint",
  "title",
  "label",
  "placeholder",
  "message",
  "dismissLabel",
  "alternativeLabel",
  "notice",
  "caption",
  "subtitle",
  "heading",
  "emptyTitle",
  "emptyMessage",
  "announcement",
]);
const BRANDS = new Set([
  "Wave",
  "YouTube Music",
  "YT Music",
  "Spotify",
  "Android Auto",
  "Genius",
  "Shazam",
]);

/** Only private tools belong here; production glass and performance code still gets scanned. */
export const TEXT_ALLOWLIST = [
  "apps/mobile/src/app/settings/developer.tsx",
  "apps/mobile/src/app/design-preview.tsx",
  "apps/mobile/src/app/dev/",
  "apps/mobile/src/dev/",
  "apps/mobile/src/perf/",
  // The design preview's synthetic Library and state galleries (only design-preview.tsx uses them).
  "apps/mobile/src/preview/",
  // Seeds fixture tracks for the store tests; never part of the app.
  "apps/mobile/src/library/db/testDatabase.ts",
  // Pure log/diagnostic builders and SVG path geometry; none returns UI copy.
  "packages/core/src/appLog.ts",
  "packages/core/src/failureCause.ts",
  "packages/core/src/importLog.ts",
  "packages/core/src/importTimings.ts",
  "packages/core/src/networkUse.ts",
  "packages/core/src/lostTap.ts",
  "packages/core/src/magicBatchReport.ts",
  "packages/core/src/slowRead.ts",
  "packages/core/src/timing.ts",
  "packages/core/src/overlayOrigin.ts",
  "packages/core/src/recognizeLog.ts",
  "packages/core/src/catalogueEn.ts",
  "packages/core/src/cataloguePtBr.ts",
  "packages/core/src/catalogue/",
];

export const isTextSource = (file) =>
  /\.tsx?$/.test(file) &&
  !/\.(?:test|d)\.tsx?$/.test(file) &&
  !TEXT_ALLOWLIST.some((entry) => (entry.endsWith("/") ? file.startsWith(entry) : file === entry));

/**
 * A comment line "// not UI text: <why>" right above a statement or property
 * skips it: a log line, a stored placeholder or an id that only looks like
 * English. The reason is required, so each exemption says what it is.
 */
const NOT_UI = /^\/\/ not UI text: \S/;

const hasText = (text) => /\p{L}/u.test(text) && !BRANDS.has(text.trim());
const textComponent = (node) =>
  /(?:Text|Title|Heading|Paragraph|Caption|Label)$/.test(node.openingElement.tagName.getText());

/** Syntactic guard: inspect visible values, never imports, enum ids, logs or error constructors. */
export function findUntranslatedText(file, source) {
  if (!isTextSource(file)) return [];
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = new Map();
  let coreReturn = false;
  const add = (node, value) => {
    const text = value.replace(/\s+/g, " ").trim();
    if (!hasText(text)) return;
    if (
      coreReturn &&
      (!/^[A-Z][a-z]|\p{L}.*\s|\s.*\p{L}/u.test(text) ||
        /^(?:[a-z][a-z0-9+.-]*:(?!\s)|\/)/i.test(text))
    )
      return;
    const start = node.getStart(tree);
    const { line, character } = tree.getLineAndCharacterOfPosition(start);
    findings.set(start, { file, line: line + 1, column: character + 1, text });
  };
  // Walk only value branches. In `${format(count, "en")} songs`, "en" is an
  // argument to a formatter, not visible text. Conditions and property keys aren't text either.
  const value = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node, node.text);
    else if (ts.isTemplateExpression(node)) {
      const words = node.head.text + node.templateSpans.map((span) => span.literal.text).join("");
      if (hasText(words)) add(node, node.getText(tree).slice(1, -1));
      for (const span of node.templateSpans) value(span.expression);
    } else if (ts.isConditionalExpression(node)) {
      value(node.whenTrue);
      value(node.whenFalse);
    } else if (ts.isBinaryExpression(node)) {
      if (
        [
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
        ].includes(node.operatorToken.kind)
      ) {
        if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) value(node.left);
        value(node.right);
      }
    } else if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      value(node.expression);
    else if (ts.isJsxExpression(node) && node.expression) value(node.expression);
    else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties)
        if (
          ts.isPropertyAssignment(prop) &&
          (UI_PROPERTIES.has(prop.name.getText(tree).replace(/["']/g, "")) ||
            prop.name.getText(tree) === "text")
        )
          value(prop.initializer);
    } else if (ts.isArrayLiteralExpression(node)) node.elements.forEach(value);
  };
  const marked = (node) =>
    (ts.isStatement(node) || ts.isPropertyAssignment(node)) &&
    (ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []).some(({ pos, end }) =>
      NOT_UI.test(source.slice(pos, end)),
    );
  const visit = (node) => {
    if (ts.isThrowStatement(node) || ts.isNewExpression(node) || marked(node)) return;
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree);
      if (/(?:^|\.)(?:log|debug|info|warn|error|trace|fatal)$/.test(name)) return;
      if (
        /(?:^|\.)(?:showToast|toast|alert|confirm|confirmAction|showMessage|showError|showAlert|announce|announceForAccessibility)$/.test(
          name,
        )
      )
        node.arguments.forEach(value);
    }
    if (ts.isJsxAttribute(node) && UI_PROPERTIES.has(node.name.getText(tree)) && node.initializer)
      value(node.initializer);
    if (
      ts.isPropertyAssignment(node) &&
      UI_PROPERTIES.has(node.name.getText(tree).replace(/["']/g, ""))
    )
      value(node.initializer);
    if (ts.isJsxElement(node) && textComponent(node)) {
      for (const child of node.children) {
        if (ts.isJsxText(child)) add(child, child.text);
        else if (ts.isJsxExpression(child)) value(child);
      }
    }
    if (
      file.startsWith("packages/core/src/") &&
      ((ts.isReturnStatement(node) && node.expression) ||
        (ts.isArrowFunction(node) && !ts.isBlock(node.body)))
    ) {
      coreReturn = true;
      value(ts.isReturnStatement(node) ? node.expression : node.body);
      coreReturn = false;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...findings.values()].toSorted((a, b) => a.line - b.line || a.column - b.column);
}
