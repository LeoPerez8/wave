# Untranslated text check

The app's and Core's tests fail when UI text is written straight in the code instead of
coming from the catalogue (`packages/core/src/catalogue/`). Run it from the repository root
(Node and workspace dev dependencies installed):

```sh
node scripts/ci/untranslated-text-report.ts
node --test apps/mobile/src/untranslatedText.test.ts packages/core/src/untranslatedText.test.ts
```

Each prints every finding with its file, line and column, then a total, and fails on any
finding. `STRICT_UNTRANSLATED_TEXT` in `scripts/ci/untranslated-text-report.ts` has been
`true` since Portuguese launched (#789). With it off, the report also takes
`TEXT_CHECK_PATH`, a repository-relative path prefix for a file or folder, and passes
whatever it finds.

## What it reads

The AST scanner (`scripts/ci/untranslated-text.mjs`) checks Text-like children, visible
property values (`accessibilityLabel`, `title`, `label`, `placeholder`, `message`…), and the
arguments of toast, alert, confirm, `confirmAction`, `showMessage`, `showAlert` and announce
calls. In Core it also checks English-shaped literals in return statements and arrow
expressions. It follows conditional and concatenated values, but doesn't trace identifiers,
imports or function calls: a Core function that builds text takes the catalogue or the
language, and the app passes it. Native text (Kotlin notifications) isn't scanned; it reads
`NativeText`, generated from the catalogue's `native` namespace by `plugins/nativeText.ts`.

Brand-only text, symbols and numbers, catalogue files, log calls and error constructors are
skipped. `TEXT_ALLOWLIST` lists the dev and diagnostic files: Settings › Developer, the
Design preview and its synthetic data, perf tools, pure log builders and store-test helpers.
Keep production UI out of it.

## Exempting a line

A log line, a stored placeholder or an id inside other code takes a comment on the line
right above its statement or property:

```ts
// not UI text: the app log's line
export const fillPauseLine = (pause: FillPause): string => `The background fill pauses…`;
```

The reason after the colon is required; a bare `// not UI text:` exempts nothing. Fixtures
and tests live in `scripts/ci/untranslated-text.test.ts` and
`scripts/ci/fixtures/untranslated-text`.

## History

On 29 October 2026, before the translation tickets #784–#788, the check found 898
findings: 589 in the app and 309 in Core. #789 brought the count to zero and turned strict
mode on.
