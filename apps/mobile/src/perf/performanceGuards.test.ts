import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { auditSources, mobileSources } from "./sourceAudit.mjs";
import {
  LIBRARY_SEEDS,
  NETWORK_SEEDS,
  OPENING_REQUESTS,
  WHOLE_LIBRARY,
} from "./performancePolicy.ts";

const sources = mobileSources(join(import.meta.dirname, ".."));
const scan = (files: Record<string, string>) =>
  auditSources(files, {
    librarySeeds: LIBRARY_SEEDS,
    networkSeeds: NETWORK_SEEDS,
    roots: Object.keys(files).filter(
      (path) =>
        path.startsWith("app/library/") ||
        /^app\/\(tabs\)\/[^/]+\/(album|artist|genre|playlist)\//.test(path) ||
        path === "nowPlaying/NowPlayingSheet.tsx",
    ),
    boundaries: Object.keys(OPENING_REQUESTS),
  });
const audit = scan(sources);

const explain = (list: typeof WHOLE_LIBRARY): void => {
  for (const [owner, entry] of Object.entries(list)) {
    assert.match(
      owner,
      /^[^*]+\.(ts|tsx)#[^*]+$/,
      "exceptions name an exact module and declaration",
    );
    assert.ok(entry.reason.trim().length > 30, `${owner} needs a reviewable reason`);
    if (entry.removeIn !== undefined)
      assert.ok(
        Number.isInteger(entry.removeIn) && entry.removeIn > 579,
        `${owner} needs its downstream removal ticket`,
      );
  }
};

test("only explicitly reviewed declarations follow whole-Library songs, finder, artists or history", () => {
  assert.deepEqual(
    audit.missingSeeds,
    [],
    "A protected API changed; update the declaration identities rather than silently losing coverage.",
  );
  explain(WHOLE_LIBRARY);
  const expected = Object.entries(WHOLE_LIBRARY)
    .flatMap(([owner, entry]) => {
      assert.ok(entry.capabilities?.length, `${owner} must name the capabilities it uses`);
      return entry.capabilities!.map((capability) => `${owner} -> ${capability}`);
    })
    .toSorted();
  assert.deepEqual(
    audit.library.map((use) => `${use.owner} -> ${use.capability}`).toSorted(),
    expected,
    "Unlisted whole-Library use (or stale exception). Target the read, or add an exact reason and removal ticket to performancePolicy.ts.",
  );
});

test("detail screens and Now Playing reach network only through reviewed opening hooks or explicit actions", () => {
  explain(OPENING_REQUESTS);
  for (const [owner, entry] of Object.entries(OPENING_REQUESTS)) {
    assert.ok(entry.kind === "opening" || entry.kind === "gesture");
    if (entry.kind === "opening") {
      if (entry.deferred !== undefined) {
        assert.equal(entry.removeIn, undefined, `${owner}: fixed boundaries carry no removal debt`);
        assert.ok(["screen", "nowPlaying"].includes(entry.deferred.settlement));
        assert.equal(entry.deferred.connectivity, "android");
        assert.ok(entry.deferred.tests.length > 0);
        for (const path of entry.deferred.tests) {
          assert.match(path, /\.test\.ts$/);
          assert.ok(
            existsSync(resolve(import.meta.dirname, "../../../../", path)),
            `${owner}: missing behavioral evidence ${path}`,
          );
        }
      } else
        assert.ok(
          entry.removeIn,
          `${owner}: an automatic ask must defer to settled and check connectivity, or name its removal ticket`,
        );
    }
  }
  assert.deepEqual(
    audit.network,
    [],
    "Unlisted opening request; via lists the aliases/wrappers from its screen. Defer until settled and check connectivity.",
  );
  assert.deepEqual(
    audit.boundaries,
    Object.keys(OPENING_REQUESTS).toSorted(),
    "Remove stale exceptions when their opening asks are fixed.",
  );
});

test("new Library followers and network asks in a tab's detail route are rejected using the real APIs", () => {
  const owner = "app/(tabs)/songs/artist/[id].tsx";
  const changed = scan({
    ...sources,
    [owner]: `
  import { libraryFinder } from '@wave/core';
  import { libraryListQueries as queries } from '@/library/hooks';
  import { LibraryStore } from '@/library/LibraryStore';
  import { useLibraryQuery } from '@/library/sharedQueries';
  import { useLoadedLibraryFinder as useFinder } from '@/ytmusic/libraryFinder';
  import { YtMusic } from '@/ytmusic/YtMusic';
  export default function Screen() {
    useLibraryQuery(queries.songs, []);
    useFinder();
    libraryFinder([]);
    LibraryStore.use(store => store.listSongs);
    LibraryStore.use(store => store.listArtists);
    LibraryStore.use(store => store.tasteHistory);
    YtMusic.use(api => api.artist('Muse'));
    fetch('https://api.deezer.com/search?q=Muse');
    fetch('https://lrclib.net/api/get');
    return null;
  }`,
  });
  assert.deepEqual(changed.network.map((use) => `${use.owner} -> ${use.capability}`).toSorted(), [
    `${owner}#Screen -> global#fetch`,
    `${owner}#Screen -> ytmusic/YtMusic.ts#artist`,
  ]);
  assert.deepEqual(
    changed.library
      .filter((use) => use.owner.startsWith(`${owner}#`))
      .map((use) => use.capability)
      .toSorted(),
    [
      "../../../packages/core/src/ytMusic.ts#libraryFinder",
      "library/LibraryStore.ts#listArtists",
      "library/LibraryStore.ts#listSongs",
      "library/LibraryStore.ts#tasteHistory",
      "library/hooks.ts#songs",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  );
});
