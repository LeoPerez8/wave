import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { NativeDownloadJob } from "@/native/waveSoulseek";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const react = JSON.stringify(import.meta.resolve("react"));
const core = JSON.stringify(import.meta.resolve("@wave/core"));

/** What the stubs count: the list's renders, and each song row's as "videoId: line". */
interface Counts {
  list: number;
  rows: string[];
}
const COUNTS_KEY = "__waveDownloadTickCounts";
const counts = (): Counts => {
  const scope = globalThis as unknown as Record<string, Counts | undefined>;
  return (scope[COUNTS_KEY] ??= { list: 0, rows: [] });
};

const [{ DownloadsList }, { journal }] = await loadWithStubs<
  [typeof import("./DownloadsList.tsx"), typeof import("../ytmusic/downloadJournal.ts")]
>(
  [
    import.meta.resolve("./DownloadsList.tsx"),
    import.meta.resolve("../ytmusic/downloadJournal.ts"),
  ],
  {
    ...nativeStubs(),
    "@/lib/timing": stubModule(`
    export const registerTimingBackground = () => {};
    export const timingBackgroundChanged = () => {};
  `),
    "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${core};
    const localisation = { language: "en", strings: catalogueOf("en") };
    export const useLocalisation = () => localisation;
    export const currentLocalisation = () => localisation;
  `),
    "@legendapp/list/react-native": stubModule(`
    import { createElement, Fragment } from ${react};
    const counts = (globalThis.${COUNTS_KEY} ??= { list: 0, rows: [] });
    // Every row drawn, as Legend List draws the ones on screen: each item through renderItem.
    export const LegendList = ({ data, keyExtractor, renderItem, ListHeaderComponent }) => {
      counts.list++;
      return createElement("view", null, ListHeaderComponent,
        data.map(item => createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item }))));
    };
  `),
    "@/settings/DownloadSongRow": stubModule(`
    import { createElement } from ${react};
    const counts = (globalThis.${COUNTS_KEY} ??= { list: 0, rows: [] });
    export const DownloadSongRow = ({ song, line, children }) => {
      counts.rows.push(song.videoId + ": " + line);
      return createElement("view", null, createElement("text", null, line), children);
    };
  `),
    "@/catalog/CatalogLine": stubModule(`export const CatalogLine = () => null;`),
    "@/catalog/Hairline": stubModule(`export const Hairline = () => null;`),
    "@/components/RowReorder": stubModule(`
    export const REORDER_HANDLE_ROOM = 44;
    export const ReorderHandle = () => null;
  `),
    "@/components/TextButton": stubModule(`export const TextButton = () => null;`),
    "@/settings/DownloadRunPanel": stubModule(`
    export const DownloadRunPanel = () => null;
    export const RunBar = () => null;
  `),
    "@/settings/downloadsDrag": stubModule(`
    export const DOWNLOAD_ROW_ESTIMATE = 80;
    const drag = { drag: null, rowDrag: {}, moveSong: () => {}, moveGroup: () => {},
      liftedStyle: {}, scrollRef: { current: null }, container: { current: null }, onLayout: () => {} };
    export const useDownloadsDrag = () => drag;
    export const useDragGrip = () => "grip";
  `),
    "@/settings/SettingsPage": stubModule(`export const SECTION_GAP = 48;`),
    "@/settings/FailedDownloadsSection": stubModule(`
    export const FailedDownloadRow = () => null;
    export const FailedGroupHeader = () => null;
    export const FailedSectionHeader = () => null;
  `),
    "@/settings/ytMusic": stubModule(`export const useYtMusicEnabled = () => true;`),
    "@/ytmusic/downloadRun": stubModule(`
    const run = { progress: { groups: new Map() } };
    export const useDownloadRun = () => run;
  `),
    "@/ytmusic/YtDownloads": stubModule(`
    const none = [];
    export const cancelQueuedDownload = () => {};
    export const useFailedDownloads = () => none;
  `),
    "@/ytmusic/youtubeThrottle": stubModule(`export const useYoutubePauseNotice = () => null;`),
  },
);

const song = (videoId: string) => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});
const roadTrip = { kind: "playlist" as const, id: "7", name: "Road Trip" };

/** The journal with "a" and "b" downloading at [a] and [b] percent and "c" and "d" waiting. */
const jobs = (a: number, b = 20): NativeDownloadJob[] =>
  [
    { id: "a", song: song("a"), phase: "transferring", received: a, total: 100, origin: roadTrip },
    { id: "b", song: song("b"), phase: "transferring", received: b, total: 100, origin: roadTrip },
    { id: "c", song: song("c"), phase: "queued", origin: roadTrip },
    { id: "d", song: song("d"), phase: "queued", origin: roadTrip },
  ] as NativeDownloadJob[];

/** The journal after native's change: the ticking job fresh (its song too), the others the same objects. */
const tick = (previous: readonly NativeDownloadJob[], received: number) =>
  previous.map((job) => (job.id === "a" ? { ...job, song: { ...job.song }, received } : job));

test("a progress tick re-renders only the row whose progress changed (#1441)", async () => {
  journal.set(jobs(10));
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(DownloadsList, { header: createElement("view") }));
  });
  try {
    assert.deepEqual(counts().rows.sort(), [
      "a: Downloading · 10%",
      "b: Downloading · 20%",
      "c: Waiting to download",
      "d: Waiting to download",
    ]);
    counts().list = 0;
    counts().rows = [];
    for (const received of [11, 12, 13, 42]) {
      await act(() => journal.set(tick(journal.get(), received)));
    }
    console.log(
      `[1441] 4 progress ticks of one of 4 songs: list ${counts().list} renders, rows ${JSON.stringify(counts().rows)}`,
    );
    assert.deepEqual(
      counts().rows,
      [
        "a: Downloading · 11%",
        "a: Downloading · 12%",
        "a: Downloading · 13%",
        "a: Downloading · 42%",
      ],
      "only the ticking song's row renders, once per tick",
    );
    assert.equal(counts().list, 0, "the list itself doesn't render for a tick");

    // A song joining is a change of membership: the list renders, and the new row appears.
    counts().rows = [];
    await act(() =>
      journal.set([
        ...journal.get(),
        { id: "e", song: song("e"), phase: "queued", origin: roadTrip } as NativeDownloadJob,
      ]),
    );
    assert.ok(counts().list > 0);
    assert.ok(counts().rows.includes("e: Waiting to download"));
    // The songs downloading keep their rows; the waiting ones may render for their new count.
    assert.deepEqual(
      counts().rows.filter((row) => row.startsWith("a") || row.startsWith("b")),
      [],
    );
  } finally {
    await act(() => renderer?.unmount());
    journal.set([]);
  }
  assert.equal(journal.listenerCount(), 1, "only the timing background still follows the journal");
});
