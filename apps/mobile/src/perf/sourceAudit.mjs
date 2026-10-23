/** Desktop-only source guard machinery; never imported by the app. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
// The workspace's existing react-doctor tool ships the classic compiler API.
// TypeScript 7's root export only exposes its version; do not silently run a
// regex fallback when that API is unavailable.

const require = createRequire(import.meta.url);
const compilerRequire = createRequire(require.resolve("react-doctor"));
const ts = compilerRequire("typescript");
if (typeof ts.createProgram !== "function")
  throw new Error(
    "The source guards require react-doctor's classic TypeScript compiler API; reinstall the locked workspace tools.",
  );

export const mobileSources = (root) => {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.ts$/.test(entry.name))
        files[relative(root, path).split(sep).join("/")] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return files;
};

/**
 * Resolve actual TypeScript symbols so import renames, barrels, namespaces,
 * literal/computed property reads and destructuring cannot change identity.
 * Every production source is scanned for Library uses: putting a new wrapper
 * in another directory still adds an unreviewed owner. Network reachability
 * follows value references (including callbacks and Effect values), through
 * wrappers, until an explicitly reviewed function boundary. This deliberately
 * over-approximates execution: event-only paths need a reasoned boundary too.
 */
const add = (map, owner, value) => {
  const values = map.get(owner) ?? new Set();
  values.add(value);
  map.set(owner, values);
};

export const auditSources = (files, options) => {
  const root = resolve(import.meta.dirname, "..");
  const absolute = new Map(Object.entries(files).map(([path, text]) => [join(root, path), text]));
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    skipLibCheck: true,
    types: [],
    paths: { "@/*": [join(root, "*")] },
  };
  const host = ts.createCompilerHost(compilerOptions);
  const originalExists = host.fileExists;
  const originalRead = host.readFile;
  const originalDirectoryExists = host.directoryExists;
  host.fileExists = (path) => absolute.has(path) || originalExists(path);
  host.readFile = (path) => absolute.get(path) ?? originalRead(path);
  host.directoryExists = (path) =>
    [...absolute.keys()].some((file) => file.startsWith(`${path}/`)) ||
    (originalDirectoryExists?.(path) ?? false);
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
  };
  const program = ts.createProgram([...absolute.keys()], compilerOptions, host);
  const checker = program.getTypeChecker();
  const pathOf = (node) => relative(root, node.getSourceFile().fileName).split(sep).join("/");
  const nameOf = (node) => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isBindingElement(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      return node.name.text;
    return undefined;
  };
  const ownerOf = (node) => {
    let owner = "<module>";
    for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
      const name = nameOf(current);
      if (name !== undefined) owner = name;
    }
    return `${pathOf(node)}#${owner}`;
  };
  const edges = new Map();
  const library = new Map();
  const asks = new Map();
  const declared = new Set(["global#fetch"]);
  const seedPaths = new Set(
    [...options.librarySeeds, ...options.networkSeeds].map((key) => key.split("#")[0]),
  );
  for (const source of program.getSourceFiles())
    if (seedPaths.has(pathOf(source))) {
      const collect = (node) => {
        if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)))
          declared.add(`${pathOf(node)}#${node.name.text}`);
        ts.forEachChild(node, collect);
      };
      collect(source);
    }
  const missingSeeds = [...options.librarySeeds, ...options.networkSeeds].filter(
    (seed) => !declared.has(seed),
  );
  const libSeeds = new Set(options.librarySeeds);
  const netSeeds = new Set(options.networkSeeds);
  const recordUse = (node, symbol) => {
    const owner = ownerOf(node);
    if (symbol?.flags && symbol.flags & ts.SymbolFlags.Alias)
      symbol = checker.getAliasedSymbol(symbol);
    if (
      symbol?.getName() === "fetch" &&
      !symbol.declarations?.some((declaration) =>
        absolute.has(declaration.getSourceFile().fileName),
      )
    )
      add(asks, owner, "global#fetch");
    for (const declaration of symbol?.declarations ?? []) {
      const identity = `${pathOf(declaration)}#${symbol.getName()}`;
      if (libSeeds.has(identity))
        library.set(`${owner}:${identity}`, { owner, capability: identity, via: [owner] });
      if (netSeeds.has(identity)) add(asks, owner, identity);
      // A service's class/type is a token, not execution of its implementation.
      if (
        absolute.has(declaration.getSourceFile().fileName) &&
        !ts.isClassDeclaration(declaration) &&
        !ts.isInterfaceDeclaration(declaration) &&
        !ts.isPropertySignature(declaration) &&
        !ts.isMethodSignature(declaration)
      )
        add(edges, owner, ownerOf(declaration));
    }
  };
  const relevantNames = new Set([...libSeeds, ...netSeeds].map((key) => key.split("#")[1]));
  const collectNames = (node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isShorthandPropertyAssignment(node)
    ) {
      if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)))
        relevantNames.add(node.name.text);
    }
    ts.forEachChild(node, collectNames);
  };
  for (const source of program.getSourceFiles())
    if (absolute.has(source.fileName)) collectNames(source);
  const visit = (node) => {
    if (
      ts.isTypeNode(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node)
    )
      return;
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const declaration = node.parent.parent;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const key = node.propertyName ?? node.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key))
          recordUse(node, checker.getTypeAtLocation(declaration.initializer).getProperty(key.text));
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const member = ts.isPropertyAccessExpression(node) ? node.name : node.argumentExpression;
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "globalThis" &&
        (ts.isIdentifier(member) || ts.isStringLiteralLike(member)) &&
        member.text === "fetch" &&
        !checker
          .getSymbolAtLocation(node.expression)
          ?.declarations?.some((declaration) => absolute.has(declaration.getSourceFile().fileName))
      )
        add(asks, ownerOf(node), "global#fetch");
      if (ts.isPropertyAccessExpression(node)) {
        if (relevantNames.has(node.name.text))
          recordUse(node, checker.getSymbolAtLocation(node.name));
      } else {
        const type = checker.getTypeAtLocation(node.expression);
        const key = node.argumentExpression;
        // Dynamic indexing conservatively follows every property, never silently skips it.
        const symbols = ts.isStringLiteralLike(key)
          ? [type.getProperty(key.text)]
          : type.getProperties();
        for (const symbol of symbols) recordUse(node, symbol);
        visit(key);
      }
      // The member's symbol identifies execution, not the receiver's bootstrap.
      if (
        !ts.isIdentifier(node.expression) ||
        (ts.isPropertyAccessExpression(node) && ["bind", "call", "apply"].includes(node.name.text))
      )
        visit(node.expression);
      return;
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const declarationName =
        "name" in parent && parent.name === node && !ts.isShorthandPropertyAssignment(parent);
      if (!declarationName) {
        if (
          node.text === "fetch" &&
          !checker
            .getSymbolAtLocation(node)
            ?.declarations?.some((d) => absolute.has(d.getSourceFile().fileName))
        )
          add(asks, ownerOf(node), "global#fetch");
        recordUse(
          node,
          ts.isShorthandPropertyAssignment(parent)
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node),
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const source of program.getSourceFiles()) if (absolute.has(source.fileName)) visit(source);
  const network = [];
  const boundaries = new Set();
  const visited = new Set();
  const walk = (owner, via, reviewed = false) => {
    const state = `${owner}:${reviewed}`;
    if (visited.has(state)) return;
    visited.add(state);
    if (options.boundaries?.includes(owner)) {
      boundaries.add(owner);
      reviewed = true;
    }
    if (!reviewed)
      for (const capability of asks.get(owner) ?? []) network.push({ owner, capability, via });
    for (const target of edges.get(owner) ?? []) walk(target, [...via, target], reviewed);
  };
  // An exception becomes stale when its last reachable request disappears,
  // even when the screen still calls the now-local hook.
  const networkCapable = new Set(asks.keys());
  for (let changed = true; changed;) {
    changed = false;
    for (const [owner, targets] of edges)
      if (!networkCapable.has(owner) && [...targets].some((target) => networkCapable.has(target))) {
        networkCapable.add(owner);
        changed = true;
      }
  }
  const owners = new Set([...edges.keys(), ...asks.keys()]);
  for (const owner of owners) if (options.roots.includes(owner.split("#")[0])) walk(owner, [owner]);
  return {
    library: [...library.values()].toSorted(
      (a, b) => a.owner.localeCompare(b.owner) || a.capability.localeCompare(b.capability),
    ),
    network,
    boundaries: [...boundaries].filter((owner) => networkCapable.has(owner)).toSorted(),
    missingSeeds,
  };
};
