import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { auditSources, handBuiltArtwork, mobileSources, rowSubscriptions } from "./sourceAudit.mjs";
import {
  ARTWORK_URI_BUILDERS,
  type Exception,
  FILE_URI,
  isRow,
  LIBRARY_SEEDS,
  NETWORK_SEEDS,
  OPENING_REQUESTS,
  OWN_PRESS,
  PRESS_SEEDS,
  RETIRED_SONG_ROWS,
  SONG_ROW,
  SONG_ROW_SITES,
  SONG_ROW_VIEW,
  SONG_ROW_VIEW_SITES,
  WHOLE_LIBRARY,
  WHOLE_SET_HOOKS,
  WHOLE_STORES,
  type WholeLibraryException,
  TASTE_SOURCE_SEEDS,
  TASTE_SOURCES,
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

const explain = (list: Record<string, Exception>): void => {
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

/**
 * Rule 6 bounds how often heavy work runs: each whole-Library exception says when it runs
 * (once per screen open, scan or explicit action), never per event, download or focus.
 */
const unboundedReads = (list: Record<string, WholeLibraryException>): string[] =>
  Object.entries(list)
    .filter(([, entry]) => {
      const howOften = typeof entry.howOften === "string" ? entry.howOften.trim() : "";
      // What a read never does ("never per event or per focus") is the bound, not a trigger.
      const triggers = howOften.replace(/\bnever\b[^.;]*/gi, "");
      return (
        howOften.length < 20 ||
        /\b(?:per|on every|every|each) (?:event|download|focus|render|frame|tick|keystroke)s?\b/i.test(
          triggers,
        )
      );
    })
    .map(([owner]) => owner);

test("only explicitly reviewed declarations follow whole-Library songs, finder, artists or history", () => {
  assert.deepEqual(
    audit.missingSeeds,
    [],
    "A protected API changed; update the declaration identities rather than silently losing coverage.",
  );
  explain(WHOLE_LIBRARY);
  assert.deepEqual(
    unboundedReads(WHOLE_LIBRARY),
    [],
    "Say how often each whole-Library read runs (once per screen open, scan or explicit action), never per event.",
  );
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
  import { Stats } from '@/stats/Stats';
  export default function Screen() {
    useLibraryQuery(queries.songs, []);
    useFinder();
    libraryFinder([]);
    LibraryStore.use(store => store.listSongs);
    LibraryStore.use(store => store.listArtists);
    LibraryStore.use(store => store.tasteHistory);
    LibraryStore.use(store => store.countedListening);
    LibraryStore.use(store => store.countedListeningPage(0));
    Stats.use(stats => stats.recaps(Date.now(), null));
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
      "library/LibraryStore.ts#countedListening",
      "library/LibraryStore.ts#countedListeningPage",
      "library/hooks.ts#songs",
      "stats/Stats.ts#recaps",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ].toSorted(),
  );
});

test("bounded taste sources retain exact deferred owners without whole-source exceptions", () => {
  const pagedAudit = auditSources(sources, {
    librarySeeds: TASTE_SOURCE_SEEDS,
    networkSeeds: [],
    roots: [],
  });
  assert.deepEqual(pagedAudit.missingSeeds, []);
  explain(TASTE_SOURCES);
  assert.deepEqual(
    pagedAudit.library.map((use) => `${use.owner} -> ${use.capability}`).toSorted(),
    Object.entries(TASTE_SOURCES)
      .flatMap(([owner, entry]) =>
        entry.capabilities!.map((capability) => `${owner} -> ${capability}`),
      )
      .toSorted(),
  );
});

test("encapsulated playlist recommendation inputs are guarded on opening paths", () => {
  const path = "app/(tabs)/songs/playlist/[id].tsx";
  const changed = scan({
    ...sources,
    [path]: `
    import { playlistRecommendationInput } from '@/library/playlistRecommendationSource';
    import { LibraryStore } from '@/library/LibraryStore';
    export default function Screen() {
      playlistRecommendationInput(7);
      LibraryStore.use(store => store.playlistRecommendationInput(7));
      return null;
    }`,
  });
  assert.deepEqual(
    changed.library
      .filter((use) => use.owner === `${path}#Screen`)
      .map((use) => use.capability)
      .toSorted(),
    [
      "library/LibraryStore.ts#playlistRecommendationInput",
      "library/playlistRecommendationSource.ts#playlistRecommendationInput",
    ],
  );
});

const scanProgress = (files: Record<string, string>) =>
  auditSources(files, {
    librarySeeds: ["library/hooks.ts#useScanProgress"],
    networkSeeds: [],
    roots: [],
  });

test("only the scan banner follows scan progress; everything else reads its status (#722)", () => {
  const followers = (files: Record<string, string>) =>
    scanProgress(files).library.map((use) => use.owner);
  assert.deepEqual(scanProgress(sources).missingSeeds, []);
  assert.deepEqual(followers(sources), ["components/ScanProgressBanner.tsx#ScanProgressBanner"]);

  const path = "library/ScanCount.tsx";
  const added = followers({
    ...sources,
    [path]: `
    import { useScanProgress } from './hooks';
    export function ScanCount() {
      return useScanProgress().status;
    }`,
  });
  assert.ok(added.includes(`${path}#ScanCount`), "a new follower of the progress is caught");

  // The store itself is subscribed only by the hooks that select from it.
  const subscribers = Object.entries(sources)
    .filter(([, text]) => /scanState\.subscribe/.test(text))
    .map(([file]) => file)
    .toSorted();
  assert.deepEqual(subscribers, ["library/LibraryScan.ts", "library/hooks.ts"]);
});

test("a whole-Library exception without a bounded how often fails (#729)", () => {
  const reason = "A planted exception whose reason is long enough to pass review.";
  const capabilities = ["library/hooks.ts#songs"];
  assert.deepEqual(
    unboundedReads({
      "planted.ts#missing": { reason, capabilities } as unknown as WholeLibraryException,
      "planted.ts#blank": { howOften: "  ", reason, capabilities },
      "planted.ts#perEvent": { howOften: "Once per download event, for each download.", reason },
      "planted.ts#perFocus": { howOften: "Re-read on every focus of the screen.", reason },
      "planted.ts#bounded": {
        howOften: "Once per explicit action; never per event or per focus.",
        reason,
      },
    }),
    ["planted.ts#missing", "planted.ts#blank", "planted.ts#perEvent", "planted.ts#perFocus"],
  );
});

// Shared components per pattern (Performance rules 3, 4, 9 and 11): one scan of the real
// sources for every guard below, and one of planted offenders against the real APIs.
const sharedSeeds = [
  SONG_ROW,
  SONG_ROW_VIEW,
  ...WHOLE_SET_HOOKS,
  ...WHOLE_STORES,
  FILE_URI,
  ...PRESS_SEEDS,
];
const sharedScan = (files: Record<string, string>) =>
  auditSources(files, { librarySeeds: sharedSeeds, networkSeeds: [], roots: [] });
const retired = new RegExp(
  `\\b(?:function|const|let|class)\\s+(${RETIRED_SONG_ROWS.join("|")})\\b`,
);

/** What each shared-component guard finds in [files]: owners, or the route to a whole set. */
const sharedReport = (files: Record<string, string>, audit = sharedScan(files)) => {
  const users = (seeds: readonly string[]) =>
    [
      ...new Set(audit.library.filter((use) => seeds.includes(use.capability)).map((u) => u.owner)),
    ].toSorted();
  return {
    missingSeeds: audit.missingSeeds,
    songRowSites: users([SONG_ROW]),
    songRowViews: users([SONG_ROW_VIEW]),
    retiredRows: Object.entries(files)
      .filter(([, text]) => retired.test(text))
      .map(([path, text]) => `${path}#${retired.exec(text)![1]}`),
    rowSubscriptions: rowSubscriptions(audit, {
      isRow,
      hooks: WHOLE_SET_HOOKS,
      stores: WHOLE_STORES,
    }).map((use) => use.via.join(" > ")),
    fileUriCallers: users([FILE_URI]),
    handBuiltArtwork: handBuiltArtwork(files)
      .filter((use) => !(use.capability === "literal" && use.owner in ARTWORK_URI_BUILDERS))
      .map((use) => `${use.owner}: ${use.via[0]}`),
    ownPress: users(PRESS_SEEDS),
  };
};
const shared = sharedReport(sources);
const listed = (list: Record<string, Exception>): string[] => {
  explain(list);
  return Object.keys(list).toSorted();
};

test("song rows are drawn only by the song list, the Queue and the previews (#716)", () => {
  assert.deepEqual(shared.missingSeeds, [], "A guarded API moved; update performancePolicy.ts.");
  assert.deepEqual(
    shared.songRowSites,
    listed(SONG_ROW_SITES),
    "Render songs through SongList or SongPreview (songs/SongList.tsx), not a song row of the screen's own.",
  );
  assert.deepEqual(
    shared.songRowViews,
    listed(SONG_ROW_VIEW_SITES),
    "Core's song row view is computed by the song list's model (songs/songListModel.ts).",
  );
  assert.deepEqual(shared.retiredRows, [], "A replaced per-screen song row came back.");
});

test("no row follows a whole set or a whole store (#715, #716)", () => {
  assert.deepEqual(
    shared.rowSubscriptions,
    [],
    "The list follows playing ids, favorites and downloads once and passes each row primitives.",
  );
});

test("artwork URIs come from the one helper (#726)", () => {
  assert.deepEqual(shared.fileUriCallers, listed(ARTWORK_URI_BUILDERS));
  assert.deepEqual(
    shared.handBuiltArtwork,
    [],
    "Use artworkUri(source, size) from catalog/artworkUri.ts, or pass the cached path to Artwork.",
  );
});

test("presses outside the shared buttons are reviewed controls of their own (#717)", () => {
  assert.deepEqual(
    shared.ownPress,
    listed(OWN_PRESS),
    "Use IconButton or TextButton (components/) for icon, text and pill buttons; list a control whose face or gesture is its own in OWN_PRESS.",
  );
});

test("planted offenders fail each shared-component guard, through the real APIs (#729)", () => {
  const planted = {
    "planted/OwnSongs.tsx": `
    import { SongRow as Row } from '@/songs/SongRow';
    import { songRowView } from '@wave/core';
    export function OwnSongs({ songs }: { songs: readonly any[] }) {
      return songs.map((song) => <Row key={song.id} {...(songRowView(song) as any)} />);
    }
    export const YtSongRow = () => null;`,
    "planted/StarredRow.tsx": `
    import { useFavoriteIds } from '@/library/favorites';
    import { queueState } from '@/playback/Queue';
    export function StarredRow({ id }: { id: number }) {
      queueState.get();
      return useFavoriteIds().has(id) ? 'starred' : null;
    }`,
    "planted/useRowPlaying.ts": `
    import { useCurrentPlayingIds } from '@/playback/hooks';
    export const useRowPlaying = (id: string) => useCurrentPlayingIds().has(id);`,
    "planted/PlayingRow.tsx": `
    import { useRowPlaying } from './useRowPlaying';
    export const PlayingRow = ({ id }: { id: string }) => (useRowPlaying(id) ? 'playing' : null);`,
    "planted/Cover.tsx": `
    import { Image } from 'expo-image';
    import { fileUri } from '@/lib/fileUri';
    export function Cover({ song }: { song: { thumbPath: string | null; artworkPath: string | null } }) {
      const built = \`file://\${song.artworkPath}\`;
      return [
        <Image source={{ uri: song.thumbPath ?? undefined }} />,
        <Image source={{ uri: fileUri(song.artworkPath) }} />,
        <Image source={{ uri: built }} />,
      ];
    }`,
    "planted/Close.tsx": `
    import { IconX } from '@tabler/icons-react-native';
    import * as RN from 'react-native';
    import { Press as Tap } from '@/motion/Press';
    export const Close = ({ onPress }: { onPress: () => void }) => (
      <Tap accessibilityLabel="Close" onPress={onPress}><IconX /></Tap>
    );
    export const Done = ({ onPress }: { onPress: () => void }) => (
      <RN.Pressable onPress={onPress}><RN.Text>Done</RN.Text></RN.Pressable>
    );`,
  };
  const found = sharedReport(planted);
  assert.deepEqual(found.missingSeeds, []);
  assert.deepEqual(found.songRowSites, ["planted/OwnSongs.tsx#OwnSongs"]);
  assert.deepEqual(found.songRowViews, ["planted/OwnSongs.tsx#OwnSongs"]);
  assert.deepEqual(found.retiredRows, ["planted/OwnSongs.tsx#YtSongRow"]);
  assert.deepEqual(found.rowSubscriptions, [
    "planted/PlayingRow.tsx#PlayingRow > planted/useRowPlaying.ts#useRowPlaying > playback/hooks.ts#useCurrentPlayingIds",
    "planted/StarredRow.tsx#StarredRow > library/favorites.ts#useFavoriteIds",
    "planted/StarredRow.tsx#StarredRow > playback/Queue.ts#queueState",
  ]);
  assert.deepEqual(found.fileUriCallers, ["planted/Cover.tsx#Cover"]);
  assert.deepEqual(found.handBuiltArtwork, [
    "planted/Cover.tsx#Cover: `file://${",
    "planted/Cover.tsx#Cover: uri: song.thumbPath ?? undefined",
  ]);
  assert.deepEqual(found.ownPress, ["planted/Close.tsx#Close", "planted/Close.tsx#Done"]);
});
