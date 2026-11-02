import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { stubModule } from "../perf/reactCompilerBuilds.ts";
import type { PlaylistRow } from "./LibraryStore.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const react = JSON.stringify(import.meta.resolve("react"));
const rows = stubModule(`
  export let rows = [];
  export const setRows = next => { rows = next; };
  export const usePlaylists = () => rows;
`);
const overlay = stubModule(`
  import { createContext } from ${react};
  export const OverlayId = createContext(undefined);
  export let opened;
  export const openOverlay = request => { opened = request; };
  export const setOverlaySearch = () => {};
  export const followUp = run => run();
  export const presentOverlay = () => Promise.resolve(null);
`);
const stubs: Record<string, string> = {
  "react-native": stubModule(`
    export const Text = "text", TextInput = "input", View = "view";
    export const Keyboard = { dismiss() {}, addListener: () => ({ remove() {} }) };
  `),
  "@tabler/icons-react-native": stubModule(`
    export const IconPlus = "plus", IconSearch = "search", IconX = "clear";
  `),
  "@/catalog/CatalogLine": stubModule('export const CatalogLine = "heading";'),
  "@/catalog/Hairline": stubModule('export const Hairline = "hairline";'),
  "@/catalog/PlaylistEntry": stubModule('export const PlaylistEntry = "article";'),
  "@/components/TextButton": stubModule(`
    import { createElement } from ${react};
    export const TextButton = ({ children, ...props }) => createElement("button", props);
  `),
  "@/components/IconButton": stubModule('export const IconButton = "nav";'),
  "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${JSON.stringify(import.meta.resolve("@wave/core"))};
    export const currentLocalisation = () => ({ language: "en", strings: catalogueOf("en") });
    export const useLocalisation = currentLocalisation;
  `),
  "@/overlay/alert": stubModule("export const confirmAction = async () => false;"),
  "@/overlay/CardEntries": stubModule('export const CardEntries = "section";'),
  "@/overlay/overlay": overlay,
  "@/overlay/toast": stubModule("export const showToast = () => {};"),
  "@/theme/useThemeColor": stubModule('export const useThemeColor = () => ["red", "gray"];'),
  "./hooks": rows,
  "./playlistImports": stubModule("export const cancelPlaylistImport = () => {};"),
  "./PhotoCropperHost": stubModule("export const framePhoto = () => {};"),
  "./playlists": stubModule(`
    export const knownPlaylists = () => [];
    export const playlistNames = async () => [];
    export const addToPlaylist = () => {}, adjustPlaylistImage = () => {},
      createPlaylist = () => {}, currentPlaylists = () => {}, deletePlaylist = () => {},
      pickPlaylistImage = () => {}, removePlaylistImage = () => {}, renamePlaylist = () => {};
  `),
  "./ytLibraryImport": stubModule("export const forgetDeletedYtLibraryPlaylists = () => {};"),
};
const expoRequire = createRequire(createRequire(import.meta.url).resolve("expo/package.json"));
const presetRequire = createRequire(expoRequire.resolve("babel-preset-expo"));
const babel = presetRequire("@babel/core");
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    if (specifier === "./PlaylistPickerSearch") specifier += ".tsx";
    if (specifier === "@/catalog/grid") specifier = "../catalog/grid.ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/PlaylistSheets.tsx") || url.endsWith("/PlaylistPickerSearch.tsx")) {
      return {
        format: "module",
        source: babel.transformSync(readFileSync(new URL(url), "utf8"), {
          filename: new URL(url).pathname,
          babelrc: false,
          configFile: false,
          plugins: [
            [presetRequire.resolve("@babel/plugin-transform-typescript"), { isTSX: true }],
            [presetRequire.resolve("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
          ],
        }).code,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
let sheets: typeof import("./PlaylistSheets.tsx");
let picker: typeof import("./PlaylistPickerSearch.tsx");
let source: { setRows: (rows: readonly PlaylistRow[]) => void };
let host: { opened: { render: (close: () => void) => ReactElement } };
try {
  sheets = await import("./PlaylistSheets.tsx");
  picker = await import("./PlaylistPickerSearch.tsx");
  source = await import(rows);
  host = await import(overlay);
} finally {
  hooks.deregister();
}

const renderCard = () => host.opened.render(() => {});

const morning = {
  id: 1,
  name: "Morning",
  sort: "morning",
  createdAt: 0,
  lastEntryAddedAt: 10,
  trackCount: 1,
  durationMs: 100,
  unavailableCount: 0,
  thumbPaths: [],
  artworkPaths: [],
  hasImage: false,
} satisfies PlaylistRow;

test("New Playlist stays above the scrolling choices until an empty search opens", () => {
  source.setRows([morning]);
  sheets.openAddToPlaylist({ title: "Song", songs: async () => [] });
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(host.opened.render(() => {}));
  });
  try {
    const entries = () => renderer!.root.findByType("section");
    assert.equal(entries().findAllByType("button").length, 0, "the creation row is pinned");
    assert.equal(renderer!.root.findAllByType("button").length, 1);
    act(() => entries().props.onOverflowChange(true));
    act(() => renderer!.root.findByType("nav").props.onPress());
    assert.equal(entries().findAllByType("button").length, 1, "empty search can scroll creation");
    act(() => renderer!.root.findByType("input").props.onChangeText("mor"));
    assert.equal(renderer!.root.findAllByType("button").length, 0);
    act(() => renderer!.root.findByType("nav").props.onPress());
    assert.equal(entries().findAllByType("button").length, 1);
    act(() => renderer!.root.findByType("nav").props.onPress());
    assert.equal(entries().findAllByType("button").length, 0);
    assert.equal(renderer!.root.findAllByType("button").length, 1);
  } finally {
    act(() => renderer!.unmount());
  }
});

test("dividers separate choices once in closed search, empty search, results and no match", () => {
  source.setRows([morning, { ...morning, id: 2, name: "Morning drive", lastEntryAddedAt: 20 }]);
  sheets.openAddToPlaylist({ title: "Song", songs: async () => [] });
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(host.opened.render(() => {}));
  });
  // Flatten layout wrappers; each visible header, choice and separator remains.
  const visible = (): string[] =>
    renderer!.root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          ["heading", "input", "button", "article", "hairline"].includes(node.type),
      )
      .map((node) => node.type as string);
  try {
    const withCreation = [
      "heading",
      "hairline",
      "button",
      "hairline",
      "article",
      "hairline",
      "article",
    ];
    assert.deepEqual(visible(), withCreation);
    act(() => renderer!.root.findByType("section").props.onOverflowChange(true));
    act(() => renderer!.root.findByType("nav").props.onPress());
    assert.deepEqual(visible(), ["input", ...withCreation.slice(1)]);
    act(() => renderer!.root.findByType("input").props.onChangeText("mor"));
    assert.deepEqual(visible(), ["input", "hairline", "article", "hairline", "article"]);
    act(() => renderer!.root.findByType("input").props.onChangeText("missing"));
    assert.deepEqual(visible(), ["input", "hairline"]);
    assert.equal(
      renderer!.root
        .findAllByType("text")
        .some((node) => node.children.includes("No playlists match")),
      true,
    );
    act(() => renderer!.root.findByType("nav").props.onPress());
    assert.deepEqual(visible(), ["input", ...withCreation.slice(1)]);
  } finally {
    act(() => renderer!.unmount());
  }
});

test("layout renders reuse search results, while a changed query or playlist updates them", () => {
  let search: ReturnType<typeof picker.usePlaylistPickerSearch<PlaylistRow>>;
  let playlists = [morning];
  function Search() {
    search = picker.usePlaylistPickerSearch(playlists);
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(Search));
  });
  try {
    act(() => search.setQuery("mor"));
    const found = search!.playlists;
    assert.deepEqual(
      found.map((row) => row.id),
      [1],
    );
    act(() => renderer!.update(createElement(Search)));
    assert.equal(search!.playlists, found, "unchanged search reuses its result");
    playlists = [{ ...morning, name: "Morning coffee", trackCount: 3 }];
    act(() => renderer!.update(createElement(Search)));
    assert.equal(search!.playlists[0]?.name, "Morning coffee");
    assert.equal(search!.playlists[0]?.trackCount, 3);
    act(() => search.setQuery("drive"));
    assert.equal(search!.noMatch, true);
    playlists = [{ ...morning, name: "Morning drive" }];
    act(() => renderer!.update(createElement(Search)));
    assert.deepEqual(
      search!.playlists.map((row) => row.name),
      ["Morning drive"],
    );
  } finally {
    act(() => renderer!.unmount());
  }
});

test("the rendered card keeps ranks through live edits and search, prepending new playlists", () => {
  const drive = { ...morning, id: 2, name: "Morning drive", lastEntryAddedAt: 20 };
  source.setRows([morning, drive]);
  sheets.openAddToPlaylist({ title: "Song", songs: async () => [] });
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(renderCard());
  });
  const names = () => renderer!.root.findAllByType("article").map((row) => row.props.name);
  try {
    assert.deepEqual(names(), ["Morning drive", "Morning"]);
    const edited = { ...morning, name: "Morning coffee", lastEntryAddedAt: 100, trackCount: 3 };
    source.setRows([edited, drive]);
    act(() => renderer!.update(renderCard()));
    assert.deepEqual(names(), ["Morning drive", "Morning coffee"]);
    assert.equal(renderer!.root.findAllByType("article")[1]?.props.detail, "3 songs");
    source.setRows([
      edited,
      drive,
      { ...morning, id: 3, name: "Morning synced", lastEntryAddedAt: 1 },
    ]);
    act(() => renderer!.update(renderCard()));
    assert.deepEqual(names(), ["Morning synced", "Morning drive", "Morning coffee"]);
    act(() => renderer!.root.findByType("section").props.onOverflowChange(true));
    act(() => renderer!.root.findByType("nav").props.onPress());
    act(() => renderer!.root.findByType("input").props.onChangeText("mor"));
    assert.deepEqual(names(), ["Morning synced", "Morning drive", "Morning coffee"]);
    source.setRows([edited]);
    act(() => renderer!.update(renderCard()));
    assert.deepEqual(names(), ["Morning coffee"]);
  } finally {
    act(() => renderer!.unmount());
  }
});
