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

/** The outermost named declaration around [node], as owners are named. */
const declarationOf = (node) => {
  let owner = "<module>";
  for (let current = node; current && !ts.isSourceFile(current); current = current.parent)
    if (
      (ts.isVariableDeclaration(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isClassDeclaration(current) ||
        ts.isBindingElement(current)) &&
      current.name &&
      ts.isIdentifier(current.name)
    )
      owner = current.name.text;
  return owner;
};

// The compiler asks with forward slashes even when node:path uses Windows separators.
const canonical = (path) => path.split(sep).join("/");

export const auditSources = (files, options) => {
  const root = resolve(import.meta.dirname, "..");
  const absolute = new Map(
    Object.entries(files).map(([path, text]) => [canonical(join(root, path)), text]),
  );
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
  host.fileExists = (path) => absolute.has(canonical(path)) || originalExists(path);
  host.readFile = (path) => absolute.get(canonical(path)) ?? originalRead(path);
  host.directoryExists = (path) =>
    [...absolute.keys()].some((file) => file.startsWith(`${canonical(path)}/`)) ||
    (originalDirectoryExists?.(path) ?? false);
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
  };
  const program = ts.createProgram([...absolute.keys()], compilerOptions, host);
  const checker = program.getTypeChecker();
  const pathOf = (node) => relative(root, node.getSourceFile().fileName).split(sep).join("/");
  // A dependency's declarations are named by its package (`react-native#Pressable`), wherever
  // the package manager put its typings.
  const moduleOf = (node) => {
    const path = pathOf(node);
    const at = path.lastIndexOf("node_modules/");
    if (at === -1) return path;
    const [scope, name] = path.slice(at + "node_modules/".length).split("/");
    return scope.startsWith("@") ? `${scope}/${name}` : scope;
  };
  const ownerOf = (node) => `${pathOf(node)}#${declarationOf(node)}`;
  const edges = new Map();
  const library = new Map();
  const asks = new Map();
  const declared = new Set(["global#fetch"]);
  const seedPaths = new Set(
    [...options.librarySeeds, ...options.networkSeeds].map((key) => key.split("#")[0]),
  );
  for (const source of program.getSourceFiles())
    if (seedPaths.has(moduleOf(source))) {
      const collect = (node) => {
        if (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)))
          declared.add(`${moduleOf(node)}#${node.name.text}`);
        ts.forEachChild(node, collect);
      };
      collect(source);
    }
  const missingSeeds = [...options.librarySeeds, ...options.networkSeeds].filter(
    (seed) => !declared.has(seed),
  );
  const libSeeds = new Set(options.librarySeeds);
  const libSeedNames = new Set(options.librarySeeds.map((key) => key.split("#")[1]));
  const netSeeds = new Set(options.networkSeeds);
  const recordUse = (node, symbol) => {
    const owner = ownerOf(node);
    // A dependency often re-exports a component under its public name from an internal one
    // (react-native's `Pressable` is `$$Pressable`), so its seeds match any re-export on the way.
    for (
      let step = symbol;
      step?.flags && step.flags & ts.SymbolFlags.Alias;
      step = checker.getImmediateAliasedSymbol(step)
    )
      for (const declaration of step.declarations ?? [])
        if (pathOf(declaration).includes("node_modules/")) {
          const identity = `${moduleOf(declaration)}#${step.getName()}`;
          if (libSeeds.has(identity)) {
            library.set(`${owner}:${identity}`, { owner, capability: identity, via: [owner] });
            add(edges, owner, identity);
          }
        }
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
      const identity = `${moduleOf(declaration)}#${symbol.getName()}`;
      if (libSeeds.has(identity)) {
        library.set(`${owner}:${identity}`, { owner, capability: identity, via: [owner] });
        add(edges, owner, identity);
      }
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
      // A receiver that is itself a seed (a store: `queueState.get()`) is still a use of it.
      else if (libSeedNames.has(node.expression.text)) {
        let receiver = checker.getSymbolAtLocation(node.expression);
        if (receiver?.flags && receiver.flags & ts.SymbolFlags.Alias)
          receiver = checker.getAliasedSymbol(receiver);
        for (const declaration of receiver?.declarations ?? []) {
          const identity = `${moduleOf(declaration)}#${receiver.getName()}`;
          if (libSeeds.has(identity)) {
            const owner = ownerOf(node);
            library.set(`${owner}:${identity}`, { owner, capability: identity, via: [owner] });
            add(edges, owner, identity);
          }
        }
      }
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
    follows: edges,
  };
};

const sorted = (uses) =>
  uses.toSorted(
    (a, b) => a.owner.localeCompare(b.owner) || a.capability.localeCompare(b.capability),
  );

/**
 * What rows follow of whole sets and stores (docs/spec.md, Performance rules 3 and 4): a
 * store a row names itself, or a whole-set hook it calls directly or through its own hooks
 * (declarations named `use…`). A narrow hook may read a store; only the row itself may not.
 */
export const rowSubscriptions = (audit, { isRow, hooks, stores }) => {
  const wholeSets = new Set(hooks);
  const wholeStores = new Set(stores);
  const found = [];
  for (const owner of audit.follows.keys()) {
    if (!isRow(owner)) continue;
    const seen = new Set([owner]);
    const walk = (from, via) => {
      for (const target of audit.follows.get(from) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        if (wholeSets.has(target) || (from === owner && wholeStores.has(target)))
          found.push({ owner, capability: target, via: [...via, target] });
        else if (/^use[A-Z0-9]/.test(target.split("#")[1] ?? "")) walk(target, [...via, target]);
      }
    };
    walk(owner, [owner]);
  }
  return sorted(found);
};

const ARTWORK_URI = /file:\/\/|content:\/\/dev\.leoperez\.wave\.artwork/;
const ARTWORK_PATHS = new Set(["thumbPath", "mediumPath", "artworkPath"]);

/**
 * Artwork URIs built by hand (Performance rule 9: one helper picks the file): a `file://` or
 * artwork-provider literal, or an image `source`'s `uri:` set straight from a cached artwork
 * path. Calls are not looked into: a helper that builds a URI shows up by its own literal or
 * its `fileUri` call. `<Artwork uri={path}>` is fine, as Artwork resolves paths itself.
 */
export const handBuiltArtwork = (files) => {
  const found = [];
  for (const [path, text] of Object.entries(files)) {
    if (!ARTWORK_URI.test(text) && ![...ARTWORK_PATHS].some((name) => text.includes(name)))
      continue;
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.ESNext,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const report = (node, capability) =>
      found.push({ owner: `${path}#${declarationOf(node)}`, capability, via: [node.getText()] });
    const readsPath = (node) => {
      if (ts.isCallExpression(node)) return false;
      if (
        (ts.isPropertyAccessExpression(node) && ARTWORK_PATHS.has(node.name.text)) ||
        (ts.isIdentifier(node) && ARTWORK_PATHS.has(node.text))
      )
        return true;
      return ts.forEachChild(node, readsPath) ?? false;
    };
    const visit = (node) => {
      if (
        (ts.isStringLiteralLike(node) ||
          ts.isTemplateHead(node) ||
          ts.isTemplateMiddle(node) ||
          ts.isTemplateTail(node)) &&
        ARTWORK_URI.test(node.text)
      )
        report(node, "literal");
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
        node.name.text === "uri" &&
        readsPath(node.initializer)
      )
        report(node, "rawPath");
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sorted(found);
};

const TEXT_TAG = /^(?:[\w$]+\.)?Text$/;
const PRESS_PROPS = new Set(["onPress", "onLongPress", "onPressIn", "onPressOut"]);

/**
 * Text pressed on its own (Performance rule 11): a `<Text>` (`RN.Text`, `Animated.Text`) given
 * a press prop, which the press seeds can't see, as React Native's Text takes presses itself.
 */
export const pressedText = (files) => {
  const found = [];
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith(".tsx") || !/\bonPress|\bonLongPress/.test(text)) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        TEXT_TAG.test(node.tagName.getText()) &&
        node.attributes.properties.some(
          (prop) => ts.isJsxAttribute(prop) && PRESS_PROPS.has(prop.name.getText()),
        )
      )
        found.push({
          owner: `${path}#${declarationOf(node)}`,
          capability: "react-native#Text",
          via: [node.tagName.getText()],
        });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sorted(found);
};

/** The declaration a node sits in (the outermost named one), for `file#name`. */
const memoOwner = (node) => {
  let owner = "(module)";
  for (let at = node.parent; at !== undefined; at = at.parent)
    if ((ts.isVariableDeclaration(at) || ts.isFunctionDeclaration(at)) && at.name !== undefined)
      owner = at.name.getText();
  return owner;
};

/** The variable an expression starts from: `a` for `a`, `a.b`, `a?.[b]!`. */
const memoRoot = (node) => {
  let at = node;
  while (
    ts.isPropertyAccessExpression(at) ||
    ts.isElementAccessExpression(at) ||
    ts.isNonNullExpression(at) ||
    ts.isParenthesizedExpression(at)
  )
    at = at.expression;
  return ts.isIdentifier(at) ? at.text : null;
};

/** The names [node] reads, leaving out property names after a dot. */
const memoReads = (node) => {
  const reads = new Set();
  const visit = (at) => {
    if (ts.isIdentifier(at) && !(ts.isPropertyAccessExpression(at.parent) && at.parent.name === at))
      reads.add(at.text);
    ts.forEachChild(at, visit);
  };
  visit(node);
  return reads;
};

/**
 * Every `useMemo`/`useCallback` dependency its function doesn't read, as
 * `file#owner: hook [dep]`. The React Compiler keys its memos on what the
 * function reads, so it drops these (#728).
 */
export const unreadMemoDependencies = (files) => {
  const found = [];
  for (const [path, text] of Object.entries(files)) {
    const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : node.expression.getText();
        const [fn, deps] = node.arguments;
        if (
          (callee === "useMemo" || callee === "useCallback") &&
          fn !== undefined &&
          deps !== undefined &&
          ts.isArrayLiteralExpression(deps)
        ) {
          const reads = memoReads(fn);
          for (const dep of deps.elements) {
            const root = memoRoot(dep);
            if (root !== null && !reads.has(root))
              found.push(`${path}#${memoOwner(node)}: ${callee} [${dep.getText()}]`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
};
