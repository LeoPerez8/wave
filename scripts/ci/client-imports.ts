import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// The locked react-doctor dependency supplies the classic compiler API, as in sourceAudit.mjs.
const require = createRequire(import.meta.url);
const ts = createRequire(require.resolve("react-doctor"))("typescript");
type AstNode = {
  readonly moduleSpecifier?: AstNode;
  readonly text: string;
  readonly kind: number;
  readonly expression: AstNode;
  readonly arguments: readonly AstNode[];
  readonly argument: AstNode;
  readonly literal: AstNode;
  readonly getStart: () => number;
};

const allowed = new Set(["@wave/core", "effect", "drizzle-orm"]);
const platform =
  /^(?:expo(?:-|\/|$)|@expo\/|react(?:-|\/|$)|@react-native\/|electron(?:-|\/|$)|@electron\/)|^drizzle-orm\/(?:expo-sqlite|op-sqlite|react-native-sqlite)(?:\/|$)/;

/** Checks source imports and the package's declared runtime dependencies. */
export const checkClientImports = (root: string): string[] => {
  const errors: string[] = [];
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  for (const name of Object.keys({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  })) {
    if (!allowed.has(name)) errors.push(`package.json: forbidden runtime dependency ${name}`);
  }
  const src = join(root, "src");
  for (const name of readdirSync(src, { recursive: true, encoding: "utf8" })) {
    if (!/\.[cm]?[jt]sx?$/.test(name)) continue;
    const file = join(src, name);
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: AstNode): void => {
      let specifier: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        specifier = node.moduleSpecifier.text;
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        specifier = node.arguments[0].text;
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      ) {
        specifier = node.argument.literal.text;
      }
      if (specifier !== undefined) {
        const outside =
          specifier.startsWith(".") &&
          relative(src, resolve(dirname(file), specifier)).startsWith("..");
        if (
          platform.test(specifier) ||
          outside ||
          isAbsolute(specifier) ||
          specifier.startsWith("@/")
        ) {
          errors.push(
            `${name}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: forbidden client import ${specifier}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return errors;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkClientImports(
    fileURLToPath(new URL("../../packages/client", import.meta.url)),
  );
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
