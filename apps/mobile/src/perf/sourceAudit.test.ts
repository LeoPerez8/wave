import assert from "node:assert/strict";
import { test } from "node:test";

import { auditSources } from "./sourceAudit.mjs";

const sources = {
  "library.ts": `export const libraryListQueries = { songs: { read: () => [] } };
    export const useFinder = () => null;`,
  "network.ts": `export const service = { artist: (name: string) => name };`,
  "wrapper.ts": `export { useFinder as renamed } from './library';
    import { service as api } from './network';
    export const wrapped = () => api['artist']('Muse');`,
  "detail.tsx": `import { renamed as useMatch, wrapped } from './wrapper';
    export const Screen = () => { useMatch(); wrapped(); return null; };`,
};
const options = {
  librarySeeds: ["library.ts#useFinder", "library.ts#songs"],
  networkSeeds: ["network.ts#artist"],
  roots: ["detail.tsx"],
};

test("the whole-Library inventory sees aliases, re-exports, namespace and destructured query access", () => {
  const audit = auditSources(
    {
      ...sources,
      "hidden.ts": `import * as lib from './library';
      const { songs: query } = lib.libraryListQueries;
      export const hidden = () => query.read();`,
    },
    options,
  );
  assert.deepEqual(audit.library.map((x) => x.owner).toSorted(), [
    "detail.tsx#Screen",
    "hidden.ts#query",
  ]);
});

test("an unlisted wrapper cannot hide an opening request; the report names the route to it", () => {
  const audit = auditSources(sources, options);
  assert.deepEqual(audit.network, [
    {
      owner: "wrapper.ts#wrapped",
      capability: "network.ts#artist",
      via: ["detail.tsx#Screen", "wrapper.ts#wrapped"],
    },
  ]);
});

test("only an exact reviewed hook stops traversal, and it stays visible in the inventory", () => {
  const audit = auditSources(sources, { ...options, boundaries: ["wrapper.ts#wrapped"] });
  assert.deepEqual(audit.network, []);
  assert.deepEqual(audit.boundaries, ["wrapper.ts#wrapped"]);
});

test("callbacks and object wrappers cannot hide requests, including fetch aliases", () => {
  const audit = auditSources(
    {
      ...sources,
      "wrapper.ts": `import { service } from './network';
      const ask = () => service.artist('Muse');
      export const wrapper = { ask };
      const request = fetch;
      export const http = () => request('https://lrclib.net/api/get');`,
      "detail.tsx": `import { wrapper, http } from './wrapper';
      export const Screen = () => { wrapper.ask(); http(); };`,
    },
    options,
  );
  assert.deepEqual(audit.network.map((use) => `${use.owner} -> ${use.capability}`).toSorted(), [
    "wrapper.ts#ask -> network.ts#artist",
    "wrapper.ts#request -> global#fetch",
  ]);
});

test("comments, strings, type-only imports and unrelated same-named helpers are not uses", () => {
  const audit = auditSources(
    {
      ...sources,
      "detail.tsx": `import type { service } from './network';
      // useFinder(); fetch('https://lrclib.net');
      const title = "useFinder()";
      const useFinder = () => title;
      export const Screen = () => useFinder();`,
    },
    options,
  );
  assert.deepEqual(audit.library, []);
  assert.deepEqual(audit.network, []);
});

test("adding a new offender in an already reviewed module still creates a separate owner", () => {
  const audit = auditSources(
    {
      ...sources,
      "wrapper.ts": `import { service } from './network';
      export const reviewed = () => service.artist('Muse');
      export const unreviewed = () => service['artist']('Queen');`,
      "detail.tsx": `import { reviewed, unreviewed } from './wrapper';
      export const Screen = () => { reviewed(); unreviewed(); };`,
    },
    { ...options, boundaries: ["wrapper.ts#reviewed"] },
  );
  assert.deepEqual(
    audit.network.map((use) => use.owner),
    ["wrapper.ts#unreviewed"],
  );
});

test("unknown computed members are conservative and changed seed declarations fail visibly", () => {
  const audit = auditSources(
    {
      ...sources,
      "detail.tsx": `import { service } from './network';
      export const Screen = (key: 'artist') => service[key]('Muse');`,
    },
    { ...options, librarySeeds: [...options.librarySeeds, "library.ts#removedAPI"] },
  );
  assert.equal(audit.network[0]?.capability, "network.ts#artist");
  assert.deepEqual(audit.missingSeeds, ["library.ts#removedAPI"]);
});

test("a detail screen cannot bypass the network guard through globalThis.fetch", () => {
  const audit = auditSources(
    {
      ...sources,
      "detail.tsx": `const { fetch: request } = globalThis;
      export const Screen = () => {
        globalThis.fetch('https://api.deezer.com/search');
        request('https://lrclib.net/api/get');
      };`,
    },
    options,
  );
  assert.deepEqual(audit.network.map((use) => use.owner).toSorted(), [
    "detail.tsx#Screen",
    "detail.tsx#request",
  ]);
});

test("destructuring a typed service parameter cannot hide a whole-history read", () => {
  const audit = auditSources(
    {
      "library.ts": `export interface Store { readonly tasteHistory: readonly unknown[] }`,
      "newHook.ts": `import type { Store } from './library';
      export function useTaste({ tasteHistory: history }: Store) { return history; }`,
    },
    { librarySeeds: ["library.ts#tasteHistory"], networkSeeds: [], roots: [] },
  );
  assert.deepEqual(
    audit.library.map((use) => `${use.owner} -> ${use.capability}`),
    ["newHook.ts#useTaste -> library.ts#tasteHistory"],
  );
});

test("a removed request makes its exception stale even if the hook is still mounted", () => {
  const audit = auditSources(
    {
      ...sources,
      "wrapper.ts": `export const wrapped = () => 'saved locally';`,
    },
    { ...options, boundaries: ["wrapper.ts#wrapped"] },
  );
  assert.deepEqual(audit.network, []);
  assert.deepEqual(audit.boundaries, []);
});
