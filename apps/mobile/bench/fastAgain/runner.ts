import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createFastAgainFixture,
  FAST_AGAIN_DESKTOP,
  FAST_AGAIN_SIZES,
  type FastAgainSize,
} from "../../src/library/db/fastAgainFixture.ts";
import { measureRead } from "./measure.ts";
import { registerBench, registeredBenches } from "./registry.ts";
import { loadWorktreeModule } from "./store.ts";
import type { BenchMeasurement, BenchVariant, FastAgainBench, ReadMeasurement } from "./types.ts";

const CURRENT_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export const parseArgs = (args: readonly string[]) => {
  let quick = false;
  let before: string | undefined;
  let reference: string | undefined;
  let bench: string | undefined;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--quick") quick = true;
    else if (arg === "--help") help = true;
    else if (arg === "--before" || arg === "--reference" || arg === "--bench") {
      const value = args[++i];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`${arg} needs a ${arg === "--bench" ? "name" : "worktree path"}`);
      if (arg === "--before") before = resolve(value);
      else if (arg === "--reference") reference = resolve(value);
      else bench = value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return {
    sizes: quick ? FAST_AGAIN_SIZES.slice(0, 2) : FAST_AGAIN_SIZES,
    quick,
    before,
    reference,
    bench,
    help,
  };
};

export interface RunOptions {
  readonly sizes: readonly FastAgainSize[];
  readonly variants: readonly { readonly variant: BenchVariant; readonly root: string }[];
  readonly runs: number;
  readonly benches: readonly FastAgainBench[];
  readonly emit: (line: Record<string, unknown>) => void;
}

type Measured = {
  readonly bench: string;
  readonly size: number;
  readonly variant: BenchVariant;
  readonly measurement: BenchMeasurement;
};
const available = (row: BenchMeasurement): row is ReadMeasurement => row.status !== "unavailable";

/** Each bench gets a fresh fixture; sequential runs avoid competing benchmark work. */
export const runBenchmarks = async (options: RunOptions): Promise<void> => {
  const emit = (line: Record<string, unknown>) =>
    options.emit({ ...line, note: FAST_AGAIN_DESKTOP });
  const measured: Measured[] = [];
  for (const size of options.sizes) {
    for (const { variant, root } of options.variants) {
      for (const bench of options.benches) {
        const fixture = await createFastAgainFixture(size);
        try {
          const measurements = await bench.run({
            fixture,
            variant,
            root,
            runs: options.runs,
            loadModule: <A>(path: string) => loadWorktreeModule<A>(root, path),
            measure: (read, run, settings) =>
              measureRead(fixture.db, read, run, { runs: options.runs, ...settings }),
          });
          assert.equal(
            new Set(measurements.map((m) => m.read)).size,
            measurements.length,
            `${bench.name}: duplicate read labels`,
          );
          for (const measurement of measurements) {
            measured.push({ bench: bench.name, size, variant, measurement });
            emit({
              kind: "measurement",
              bench: bench.name,
              size,
              playEvents: fixture.playEvents,
              variant,
              ...measurement,
            });
          }
          const ranked = measurements.filter(available).toSorted((a, b) => b.medianMs - a.medianMs);
          emit({
            kind: "slowest",
            bench: bench.name,
            size,
            variant,
            reads: ranked
              .slice(0, 20)
              .map((m) => ({ read: m.read, medianMs: m.medianMs, rowsRead: m.rowsRead })),
          });
          if (size === 12000)
            emit({
              kind: "overBudget",
              bench: bench.name,
              size,
              variant,
              budgetMs: 16,
              reads: ranked
                .filter((m) => m.medianMs > 16)
                .map((m) => ({ read: m.read, medianMs: m.medianMs, rowsRead: m.rowsRead })),
            });
        } finally {
          fixture.close();
        }
      }
    }
  }
  for (const bench of options.benches) {
    const rows: Record<string, unknown>[] = [];
    for (const size of options.sizes) {
      const reads = [
        ...new Set(
          measured
            .filter((r) => r.bench === bench.name && r.size === size)
            .map((r) => r.measurement.read),
        ),
      ];
      for (const read of reads) {
        const cells = Object.fromEntries(
          options.variants.map(({ variant }) => [
            variant,
            measured.find(
              (r) =>
                r.bench === bench.name &&
                r.size === size &&
                r.variant === variant &&
                r.measurement.read === read,
            )?.measurement ?? null,
          ]),
        );
        const results = Object.values(cells).filter(
          (m): m is ReadMeasurement => m !== null && available(m) && m.resultKey !== undefined,
        );
        for (const result of results.slice(1))
          assert.equal(
            result.resultKey,
            results[0]!.resultKey,
            `${bench.name}/${size}/${read}: worktree results differ`,
          );
        rows.push({
          size,
          read,
          before: cells.before ?? null,
          after: cells.after ?? null,
          reference: cells.reference ?? null,
        });
      }
    }
    // A JSON table stays machine-readable; every row retains all work and timing measures.
    emit({
      kind: "comparison",
      bench: bench.name,
      columns: ["size", "read", "before", "after", "reference"],
      rows,
    });
  }
};

const discoverBenches = async (): Promise<readonly FastAgainBench[]> => {
  const directory = new URL("./benches/", import.meta.url);
  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".ts")).toSorted()) {
    const module = (await import(new URL(name, directory).href)) as { bench: FastAgainBench };
    if (module.bench === undefined) throw new Error(`${name} must export bench`);
    registerBench(module.bench);
  }
  return registeredBenches();
};

const revision = (root: string): string | null => {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const printLine = (line: Record<string, unknown>): void =>
  console.log(JSON.stringify({ ...line, note: FAST_AGAIN_DESKTOP }));

export const main = async (args = process.argv.slice(2)): Promise<void> => {
  const parsed = parseArgs(args);
  const emit = printLine;
  if (parsed.help) {
    emit({
      kind: "help",
      usage:
        "bench:fast-again [--quick] [--before <ti worktree>] [--reference <v0.7.0-ti worktree>] [--bench <name>]",
    });
    return;
  }
  const variants: { variant: BenchVariant; root: string }[] = [
    { variant: "after", root: CURRENT_ROOT },
  ];
  if (parsed.before !== undefined) variants.push({ variant: "before", root: parsed.before });
  if (parsed.reference !== undefined)
    variants.push({ variant: "reference", root: parsed.reference });
  for (const { root } of variants) {
    if (!existsSync(resolve(root, "apps/mobile/src/library/LibraryStore.ts")))
      throw new Error(`no Wave LibraryStore at worktree path: ${root}`);
  }
  const benches = (await discoverBenches()).filter(
    (b) => parsed.bench === undefined || b.name === parsed.bench,
  );
  if (benches.length === 0) throw new Error(`unknown or empty bench selection: ${parsed.bench}`);
  const runs = parsed.quick ? 3 : 11;
  emit({
    kind: "meta",
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    sizes: parsed.sizes,
    runs,
    benches: benches.map((b) => b.name),
    variants: variants.map((v) => ({ ...v, commit: revision(v.root) })),
    metrics:
      "rowsRead = SQL rows returned (not VM visits); CPU = mean per run; longestSyncTaskMs = max timed synchronous operation; comparison is a table of JSON cells",
  });
  await runBenchmarks({ sizes: parsed.sizes, variants, runs, benches, emit });
};
