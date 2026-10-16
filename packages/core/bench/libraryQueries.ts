/**
 * Counts Library reads for the app's query hooks in four scripted sessions,
 * once as the old `useLibraryQuery` behaved (every mounted consumer follows
 * `libraryVersion` on its own, 1.5 s throttle, never paused) and once
 * through Core's shared registry (`createLibraryQueries`), on the same event
 * script and a virtual clock.
 *
 * Run from packages/core with plain Node (no dependencies):
 *
 *   node bench/libraryQueries.ts
 *
 * The old behaviour is modelled here from apps/mobile/src/library/hooks.ts at
 * 761375e; the consumers per screen come from the codebase map. These are
 * desktop model counts (reads started, results held), not phone
 * measurements: a read's cost depends on the query (the Songs list reads
 * every track; a count reads one row).
 */
import {
  createLibraryQueries,
  type LibraryChange,
  type LibraryQueryConsumer,
  type LibraryReads,
} from "../src/index.ts";

/** How long a read takes on the virtual clock: long enough for reads to overlap. */
const READ_MS = 30;
const THROTTLE_MS = 1500;

type LegacyEdit = "playlists" | "favorites" | "plays";

interface QueryShape {
  readonly reads: LibraryReads;
  /** What the old hook re-ran on at once, besides `libraryEdits`. */
  readonly edits: readonly LegacyEdit[];
}

const QUERIES: Readonly<Record<string, QueryShape>> = {
  songs: { reads: { tracks: true }, edits: [] },
  trackCount: { reads: { tracks: true }, edits: [] },
  libraryCounts: {
    reads: { tracks: true, playlists: true, favorites: true },
    edits: ["playlists", "favorites"],
  },
  scanRoots: { reads: { tracks: true, folders: true }, edits: [] },
  albums: { reads: { tracks: true }, edits: [] },
  "album:3": { reads: { tracks: true }, edits: [] },
  missingSongs: { reads: { tracks: true }, edits: [] },
  playlists: { reads: { tracks: true, playlists: true }, edits: ["playlists"] },
  "playlist:7": { reads: { tracks: true, playlists: [7] }, edits: ["playlists"] },
  home: { reads: { tracks: true, favorites: true, plays: true }, edits: ["favorites", "plays"] },
  listeningOverview: { reads: { tracks: true, plays: true }, edits: ["plays"] },
};

/** A virtual clock with timers. */
const makeClock = () => {
  let time = 10_000;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => time,
    schedule: (ms: number, run: () => void): (() => void) => {
      const id = nextId++;
      timers.set(id, { at: time + ms, run });
      return () => timers.delete(id);
    },
    advance: (ms: number): void => {
      const end = time + ms;
      for (;;) {
        let due: [number, { at: number; run: () => void }] | undefined;
        for (const timer of timers)
          if (timer[1].at <= end && (!due || timer[1].at < due[1].at)) due = timer;
        if (due === undefined) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].run();
      }
      time = end;
    },
  };
};

type Clock = ReturnType<typeof makeClock>;

/** One mounted hook call: on a screen, which is in sight or not. */
interface Mount {
  readonly key: string;
  readonly screen: string;
}

/** What a session does to the queries: the same calls drive both models. */
interface Model {
  readonly mount: (mount: Mount, visible: boolean) => void;
  readonly unmount: (mount: Mount) => void;
  readonly sight: (screen: string, visible: boolean) => void;
  readonly change: (change: LibraryChange) => void;
  readonly reads: Map<string, number>;
  /** Most query results held at once (each copy counts). */
  readonly peakHeld: () => number;
}

const count = (reads: Map<string, number>, key: string): void => {
  reads.set(key, (reads.get(key) ?? 0) + 1);
};

/** The old hook: each consumer reads on its own (hooks.ts at 761375e). */
const legacyModel = (clock: Clock): Model => {
  interface Consumer {
    readonly mount: Mount;
    visible: boolean;
    lastRun: number;
    cancel: (() => void) | null;
    held: boolean;
    /** Plays seen while hidden: `useFocusedVersion` re-runs on return. */
    missedPlays: boolean;
  }
  const consumers = new Set<Consumer>();
  const reads = new Map<string, number>();
  let peak = 0;
  const held = (): number => [...consumers].filter((consumer) => consumer.held).length;
  const run = (consumer: Consumer): void => {
    consumer.cancel?.();
    consumer.cancel = null;
    consumer.lastRun = clock.now();
    count(reads, consumer.mount.key);
    clock.schedule(READ_MS, () => {
      if (!consumers.has(consumer)) return;
      consumer.held = true;
      peak = Math.max(peak, held());
    });
  };
  /** The run/throttle effect re-running: at once for an edit, else at most every 1.5 s. */
  const effect = (consumer: Consumer, edited: boolean): void => {
    consumer.cancel?.();
    consumer.cancel = null;
    const wait = edited ? 0 : consumer.lastRun + THROTTLE_MS - clock.now();
    if (wait <= 0) run(consumer);
    else consumer.cancel = clock.schedule(wait, () => run(consumer));
  };
  return {
    reads,
    peakHeld: () => peak,
    mount: (mount, visible) => {
      const consumer: Consumer = {
        mount,
        visible,
        lastRun: 0,
        cancel: null,
        held: false,
        missedPlays: false,
      };
      consumers.add(consumer);
      run(consumer);
    },
    unmount: (mount) => {
      for (const consumer of consumers) {
        if (consumer.mount !== mount) continue;
        consumer.cancel?.();
        consumers.delete(consumer);
      }
    },
    sight: (screen, visible) => {
      for (const consumer of consumers) {
        if (consumer.mount.screen !== screen) continue;
        consumer.visible = visible;
        if (visible && consumer.missedPlays) {
          consumer.missedPlays = false;
          effect(consumer, true);
        }
      }
    },
    change: (change) => {
      for (const consumer of consumers) {
        const shape = QUERIES[consumer.mount.key]!;
        if (change.kind === "tracks" || change.kind === "folders") {
          // Every consumer followed libraryVersion; edits (not scan batches) bumped libraryEdits too.
          effect(consumer, change.burst !== true);
        } else if (change.kind === "plays") {
          if (!shape.edits.includes("plays")) continue;
          if (consumer.visible) effect(consumer, true);
          else consumer.missedPlays = true;
        } else if (shape.edits.includes(change.kind)) {
          effect(consumer, true);
        }
      }
    },
  };
};

/** The shared registry, as `useLibraryQuery` drives it now. */
const sharedModel = (clock: Clock): Model => {
  const reads = new Map<string, number>();
  let peak = 0;
  const queries = createLibraryQueries<string>({
    now: clock.now,
    schedule: clock.schedule,
    read: (key, settle) => {
      count(reads, key);
      clock.schedule(READ_MS, () => {
        settle({ ok: true, value: key });
        const { entries } = queries.stats();
        peak = Math.max(peak, entries);
      });
    },
  });
  const attached = new Map<Mount, LibraryQueryConsumer>();
  return {
    reads,
    peakHeld: () => peak,
    mount: (mount, visible) => {
      const shape = QUERIES[mount.key]!;
      attached.set(mount, queries.attach(mount.key, shape.reads, { visible, onChange: () => {} }));
    },
    unmount: (mount) => {
      attached.get(mount)?.detach();
      attached.delete(mount);
    },
    sight: (screen, visible) => {
      for (const [mount, consumer] of attached) {
        if (mount.screen !== screen) continue;
        if (visible) consumer.show();
        else consumer.hide();
      }
    },
    change: (change) => queries.change(change),
  };
};

/** The hook calls each screen makes (codebase map, #309 section). */
const SCREENS: Readonly<Record<string, readonly string[]>> = {
  home: ["home", "listeningOverview"],
  library: ["home", "trackCount", "libraryCounts", "scanRoots"],
  settings: ["scanRoots", "scanRoots", "missingSongs"],
  songs: ["songs", "scanRoots"],
  albums: ["albums"],
  album: ["album:3"],
  playlists: ["playlists"],
  playlist: ["playlist:7"],
};

/** Drives a model through a session; screens mount, show and hide by name. */
const session = (model: Model, clock: Clock) => {
  const mounted = new Map<string, Mount[]>();
  return {
    open: (screen: string, visible: boolean): void => {
      const mounts = SCREENS[screen]!.map((key) => ({ key, screen }));
      mounted.set(screen, mounts);
      for (const mount of mounts) model.mount(mount, visible);
    },
    close: (screen: string): void => {
      for (const mount of mounted.get(screen) ?? []) model.unmount(mount);
      mounted.delete(screen);
    },
    show: (screen: string) => model.sight(screen, true),
    hide: (screen: string) => model.sight(screen, false),
    change: (change: LibraryChange) => model.change(change),
    wait: (ms: number) => clock.advance(ms),
  };
};

type Session = ReturnType<typeof session>;

/** Home, Library and Settings tabs mounted (tabs stay mounted), Home in sight. */
const tabs = (s: Session): void => {
  s.open("home", true);
  s.open("library", false);
  s.open("settings", false);
  s.wait(2000);
};

/** Visits every tab once, from [from], ending back on it. */
const visitTabs = (s: Session, from: string): void => {
  let at = from;
  for (const tab of ["home", "library", "settings", from]) {
    if (tab === at) continue;
    s.hide(at);
    s.show(tab);
    s.wait(1000);
    at = tab;
  }
};

const SESSIONS: Readonly<Record<string, (s: Session) => void>> = {
  /** A first scan of 150 batches, 80 ms apart, watched from Library › Songs. */
  scan: (s) => {
    tabs(s);
    s.hide("home");
    s.open("songs", true);
    s.wait(1000);
    for (let batch = 0; batch < 150; batch++) {
      s.change({ kind: "tracks", burst: true });
      s.wait(80);
    }
    s.change({ kind: "tracks", burst: true });
    s.wait(3000);
    // Then every tab is visited once: hidden ones catch up now.
    s.close("songs");
    s.show("library");
    s.wait(1000);
    visitTabs(s, "library");
  },
  /** A playlist import filling playlist 7 once a second for a minute, watched from Home. */
  import: (s) => {
    tabs(s);
    s.open("playlists", false);
    s.open("playlist", false);
    s.wait(1000);
    for (let add = 0; add < 60; add++) {
      s.change({ kind: "playlists", ids: [7], burst: true });
      s.wait(1000);
    }
    s.wait(3000);
    // Then the playlist is opened from Library › Playlists, and every tab visited.
    s.show("playlists");
    s.wait(1000);
    s.hide("playlists");
    s.show("playlist");
    s.wait(1000);
    s.hide("playlist");
    visitTabs(s, "home");
  },
  /** Library › Albums and back ten times, an album and back ten times, then ten tab rounds. */
  navigation: (s) => {
    tabs(s);
    s.hide("home");
    s.show("library");
    for (let round = 0; round < 10; round++) {
      s.hide("library");
      s.open("albums", true);
      s.wait(800);
      s.close("albums");
      s.show("library");
      s.wait(800);
    }
    for (let round = 0; round < 10; round++) {
      s.hide("library");
      s.open("album", true);
      s.wait(800);
      s.close("album");
      s.show("library");
      s.wait(800);
    }
    for (let round = 0; round < 10; round++) {
      for (const [from, to] of [
        ["library", "home"],
        ["home", "settings"],
        ["settings", "library"],
      ] as const) {
        s.hide(from);
        s.show(to);
        s.wait(500);
      }
    }
  },
  /** 40 songs played (a start and an end each) with Now Playing over Home, and five stars. */
  playback: (s) => {
    tabs(s);
    s.hide("home"); // Now Playing opens over it
    for (let song = 0; song < 40; song++) {
      s.change({ kind: "plays", ids: [song], burst: true });
      s.wait(1000);
      s.change({ kind: "plays", ids: [song], burst: true });
      if (song % 8 === 0) s.change({ kind: "favorites", ids: [song] });
      s.wait(1000);
    }
    s.show("home"); // Now Playing closes
    s.wait(1000);
    visitTabs(s, "home");
  },
};

const total = (reads: Map<string, number>): number =>
  [...reads.values()].reduce((sum, value) => sum + value, 0);

const rows: string[] = [
  "| Session | Old reads | Shared reads | Change | Old results held (peak) | Shared results held (peak) |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
];
const details: string[] = [];
for (const [name, script] of Object.entries(SESSIONS)) {
  const oldClock = makeClock();
  const old = legacyModel(oldClock);
  script(session(old, oldClock));
  const newClock = makeClock();
  const shared = sharedModel(newClock);
  script(session(shared, newClock));
  const before = total(old.reads);
  const after = total(shared.reads);
  const change = before === 0 ? "-" : `${Math.round(((after - before) / before) * 100)}%`;
  rows.push(
    `| ${name} | ${before} | ${after} | ${change} | ${old.peakHeld()} | ${shared.peakHeld()} |`,
  );
  const keys = [...new Set([...old.reads.keys(), ...shared.reads.keys()])].toSorted();
  details.push(
    `${name}: ${keys.map((key) => `${key} ${old.reads.get(key) ?? 0}→${shared.reads.get(key) ?? 0}`).join(", ")}`,
  );
}
console.log(rows.join("\n"));
console.log();
console.log(details.join("\n"));
