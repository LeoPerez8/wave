/**
 * Benchmarks a large Spotify playlist import through Core's public API, as
 * the app runs it (apps/mobile/src/library/playlistImports.ts): ask what's
 * next, keep at most four searches in flight, let answers arrive out of
 * order with a few refusals, give the playlist what's settled at most once a
 * simulated second, and after every change work out the notification's
 * progress and the open playlist page's line.
 *
 * Run from packages/core with plain Node (no dependencies):
 *
 *   node bench/playlistImport.ts            # timings and operation counts
 *   node bench/playlistImport.ts --quick    # smaller sizes
 *
 * Time is simulated; CPU times are this machine's (desktop Node), not phone
 * frame timings. Operation counts come from a separate pass that wraps the
 * import's `songs` and `finds` arrays in counting proxies: "visited" is every
 * single entry Core read, "copied" every entry it copied in bulk (`slice`).
 * The outcome line (what the playlist was given, in order, and how every
 * song was settled) must be identical before and after a change to the
 * planner.
 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  importAdded,
  importAdditions,
  importSearchAnswered,
  nextImportStep,
  planLinkImport,
  playlistImportProgress,
  playlistImportView,
  playlistSongKey,
  readSpotifySearchPacing,
  startPlaylistImport,
  updatePlaylistImport,
  type PlaylistImport,
  type PlaylistImports,
  type PlaylistSong,
  type SpotifySong,
  type YtSong,
  type YtSongSearch,
} from "../src/index.ts";

const quick = process.argv.includes("--quick");
const TIMED_SIZES = quick ? [250, 1000] : [500, 1000, 2000, 5000, 10_000];
const COUNTED_SIZES = quick ? [250, 1000] : [500, 1000, 2000, 4000];
const GIVE_EVERY_MS = 1000;
const AT_ONCE = 4;

/** A small seeded generator (mulberry32), so every run sees the same answers in the same order. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};

interface Fixture {
  readonly songs: readonly SpotifySong[];
  readonly library: readonly { id: number; title: string; artist: string; durationMs: number }[];
  /** What YouTube Music answers each search with. */
  readonly answers: ReadonlyMap<string, readonly YtSong[]>;
}

/** The YouTube Music song that is [song], the [index]th listed. */
const video = (index: number, song: SpotifySong): YtSong => ({
  videoId: `v${index}`,
  title: song.title,
  artists: [...song.artists],
  album: song.album,
  durationMs: song.durationMs,
  artworkUrl: null,
  explicit: false,
});

/**
 * [size] Spotify songs: one in ten the Library has, one in 25 listed again
 * on another album (searched once), one in 40 YouTube Music hasn't, and one
 * in 60 the same recording another search finds too (given once).
 */
const fixture = (size: number): Fixture => {
  const songs: SpotifySong[] = [];
  const library: { id: number; title: string; artist: string; durationMs: number }[] = [];
  const answers = new Map<string, YtSong[]>();
  for (let index = 0; index < size; index += 1) {
    if (index % 25 === 24 && index >= 7) {
      const again = songs[index - 7];
      if (again !== undefined) {
        songs.push({ ...again, album: `${again.album ?? ""} (Deluxe)` });
        continue;
      }
    }
    if (index % 60 === 59) {
      // Credited with a guest: its own search, but the same video as the song before.
      const before = songs[index - 1];
      if (before !== undefined && before.artists.length === 1) {
        const song = { ...before, artists: [...before.artists, `Guest ${index}`] };
        songs.push(song);
        const query = [song.title, ...song.artists].join(" ");
        answers.set(query, answers.get([before.title, ...before.artists].join(" ")) ?? []);
        continue;
      }
    }
    const song: SpotifySong = {
      title: `Song ${index}`,
      artists: [`Artist ${index % 97}`],
      album: `Album ${index % 131}`,
      durationMs: 150_000 + ((index * 7919) % 120_000),
    };
    songs.push(song);
    if (index % 10 === 3) {
      library.push({
        id: index + 1,
        title: song.title,
        artist: song.artists[0] ?? "",
        durationMs: song.durationMs ?? 0,
      });
    }
    const query = [song.title, ...song.artists].join(" ");
    answers.set(query, index % 40 === 17 ? [] : [video(index, song)]);
  }
  return { songs, library, answers };
};

interface Calls {
  [name: string]: { calls: number; ms: number };
}

/** The Core calls the run makes, timed. */
const timed = (calls: Calls) => {
  const time =
    <A extends unknown[], R>(name: string, run: (...args: A) => R) =>
    (...args: A): R => {
      const before = performance.now();
      const result = run(...args);
      const tally = (calls[name] ??= { calls: 0, ms: 0 });
      tally.calls += 1;
      tally.ms += performance.now() - before;
      return result;
    };
  return {
    nextImportStep: time("nextImportStep", nextImportStep<YtSong>),
    importSearchAnswered: time("importSearchAnswered", importSearchAnswered<YtSong>),
    importAdditions: time("importAdditions", importAdditions<YtSong>),
    importAdded: time("importAdded", importAdded<YtSong>),
    updatePlaylistImport: time("updatePlaylistImport", updatePlaylistImport<YtSong>),
    playlistImportProgress: time("playlistImportProgress", playlistImportProgress<YtSong>),
    playlistImportView: time("playlistImportView", playlistImportView<YtSong>),
  };
};

/** Counts the entries Core reads one at a time, and those it copies in bulk. */
const counter = () => {
  const counts = { visited: 0, copied: 0 };
  const proxies = new WeakMap<object, object>();
  const index = /^\d+$/u;
  const counting = <T extends object>(array: T): T => {
    const known = proxies.get(array);
    if (known !== undefined) return known as T;
    const proxy = new Proxy(array, {
      get(target, key, receiver) {
        if (typeof key === "string" && index.test(key)) {
          counts.visited += 1;
          return Reflect.get(target, key);
        }
        if (key === "slice") {
          return (...args: unknown[]) => {
            const copy = (target as unknown as unknown[]).slice(...(args as [number, number]));
            counts.copied += copy.length;
            return counting(copy);
          };
        }
        if (key === "map" || key === "filter") {
          const method = Reflect.get(target, key) as (...args: unknown[]) => object;
          return (...args: unknown[]) => counting(Reflect.apply(method, receiver, args));
        }
        return Reflect.get(target, key, receiver);
      },
    });
    proxies.set(array, proxy);
    return proxy;
  };
  return { counts, counting };
};

interface Run {
  readonly calls: Calls;
  readonly answers: number;
  readonly gives: number;
  readonly simulatedMinutes: number;
  readonly outcome: string;
  /** The counts as the import ended, before the outcome is read. */
  readonly counted: { visited?: number; copied?: number };
}

/** One import of [size] songs, run to the end as the app runs it. */
const run = (
  size: number,
  wrap?: <T extends object>(array: T) => T,
  counts?: () => { visited: number; copied: number },
): Run => {
  const { songs, library, answers } = fixture(size);
  const calls: Calls = {};
  const core = timed(calls);
  const chance = random(size);
  const plan = planLinkImport(
    {
      service: "spotify",
      playlist: { title: "Big", artworkUrl: null, songs, truncated: false, total: songs.length },
    },
    library,
  );
  let job: PlaylistImport<YtSong> = startPlaylistImport(plan, { playlistId: 1, name: "Big" });
  if (wrap !== undefined) job = { ...job, songs: wrap(job.songs), finds: wrap(job.finds) };
  let imports: PlaylistImports<YtSong> = [job];
  let pacing = readSpotifySearchPacing(null);
  let now = 0;
  let givenAt = -Infinity;
  let answered = 0;
  let gives = 0;
  const refusedOnce = new Set<string>();
  const given: PlaylistSong<YtSong>[] = [];
  const flying: { query: string; at: number }[] = [];

  /** As the app's `setImports`: keep it, show the progress, redraw the open page. */
  const set = (next: PlaylistImport<YtSong>) => {
    imports = core.updatePlaylistImport(imports, next);
    job = next;
    core.playlistImportProgress(imports);
    core.playlistImportView(imports, 1, now, pacing);
  };

  for (;;) {
    if (job.state.kind !== "importing") break;
    const { job: next, step, searches } = core.nextImportStep(job, now, pacing);
    if (step.kind === "search") {
      pacing = searches;
      set(next);
      // Most answers take under a second; one in 50 takes half a minute.
      const latency = chance() < 0.02 ? 30_000 : 150 + Math.floor(chance() * 1200);
      flying.push({ query: step.query, at: now + latency });
      continue;
    }
    const additions = core.importAdditions(job);
    const toGive = additions.through > job.added;
    if (toGive && (step.kind === "none" || now - givenAt >= GIVE_EVERY_MS)) {
      givenAt = now;
      gives += 1;
      given.push(...additions.songs);
      set(core.importAdded(job, additions.through));
      continue;
    }
    if (step.kind === "none") break;
    const arrival = Math.min(...flying.map(({ at }) => at));
    const until = Math.min(
      step.kind === "wait" ? step.untilMs : Infinity,
      toGive ? givenAt + GIVE_EVERY_MS : Infinity,
      arrival,
    );
    now = Math.max(now, until);
    flying.sort((a, b) => a.at - b.at);
    while (flying.length > 0 && (flying[0]?.at ?? Infinity) <= now) {
      const { query } = flying.shift() ?? { query: "" };
      let answer: YtSongSearch<YtSong>;
      // One search in 150 is refused the first time it's asked.
      if (!refusedOnce.has(query) && chance() < 1 / 150) {
        refusedOnce.add(query);
        answer = { ok: false, reason: "failed" };
      } else {
        answer = { ok: true, songs: answers.get(query) ?? [] };
      }
      answered += 1;
      set(core.importSearchAnswered(job, query, answer, now));
    }
  }
  if (flying.length > AT_ONCE) throw new Error("more searches in flight than allowed");
  const counted = { ...counts?.() };
  return {
    calls,
    answers: answered,
    gives,
    simulatedMinutes: Math.round(now / 60_000),
    outcome: outcome(given, job),
    counted,
  };
};

/** A fingerprint of what the playlist was given, in order, and how every song was settled. */
const outcome = (given: readonly PlaylistSong<YtSong>[], job: PlaylistImport<YtSong>): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        given: given.map(playlistSongKey),
        finds: Array.from({ length: job.finds.length }, (_, index) => {
          const found = job.finds[index] ?? null;
          if (found === null) return null;
          if (found.kind === "ytMusic") return found.song.videoId;
          return found.kind === "library" ? found.trackId : 0;
        }),
        added: job.added,
        state: job.state,
      }),
    )
    .digest("hex")
    .slice(0, 16);

const round = (ms: number) => Math.round(ms * 10) / 10;

console.log(
  JSON.stringify({
    kind: "environment",
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    note: "Desktop Node, simulated time. CPU times are not on-device frame measurements.",
  }),
);

for (const size of TIMED_SIZES) {
  run(Math.min(size, 500)); // warm up the JIT
  const result = run(size);
  const total = Object.values(result.calls).reduce((sum, { ms }) => sum + ms, 0);
  console.log(
    JSON.stringify({
      kind: "timed",
      size,
      answers: result.answers,
      gives: result.gives,
      simulatedMinutes: result.simulatedMinutes,
      outcome: result.outcome,
      coreMs: round(total),
      perAnswerUs: Math.round((total / result.answers) * 1000),
      byCall: Object.fromEntries(
        Object.entries(result.calls).map(([name, { calls, ms }]) => [
          name,
          { calls, ms: round(ms) },
        ]),
      ),
    }),
  );
}

for (const size of COUNTED_SIZES) {
  const { counts, counting } = counter();
  const result = run(size, counting, () => counts);
  console.log(
    JSON.stringify({
      kind: "counted",
      size,
      answers: result.answers,
      outcome: result.outcome,
      visited: result.counted.visited,
      visitedPerAnswer: Math.round((result.counted.visited ?? 0) / result.answers),
      copied: result.counted.copied,
      copiedPerAnswer: Math.round((result.counted.copied ?? 0) / result.answers),
    }),
  );
}
