import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBenchRegistry } from "../../bench/fastAgain/registry.ts";
import { parseArgs, runBenchmarks } from "../../bench/fastAgain/runner.ts";

test("quick runs every registered bench at both sizes against selected worktree modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wave-fast-again-"));
  const roots = ["after", "before", "reference"] as const;
  try {
    for (const variant of roots) {
      await mkdir(join(directory, variant), { recursive: true });
      await writeFile(join(directory, variant, "probe.ts"), `export const label = '${variant}';`);
    }
    const seen: string[] = [];
    const registry = createBenchRegistry();
    for (const name of ["first", "second"])
      registry.registerBench({
        name,
        async run(context) {
          const module = await context.loadModule<{ label: string }>("probe.ts");
          seen.push(`${name}:${context.fixture.size}:${module.label}`);
          return [context.measure("one read", () => context.fixture.db.get("SELECT 1"))];
        },
      });
    const lines: Record<string, unknown>[] = [];
    await runBenchmarks({
      sizes: parseArgs(["--quick", "--before", directory, "--reference", directory]).sizes,
      variants: roots.map((variant) => ({ variant, root: join(directory, variant) })),
      runs: 1,
      benches: registry.registeredBenches(),
      emit: (line) => lines.push(line),
    });
    assert.equal(seen.length, 12);
    assert.ok(seen.includes("second:12000:reference"));
    assert.ok(seen.every((entry) => !entry.includes("50000")));
    assert.equal(lines.filter((line) => line.kind === "comparison").length, 2);
    assert.ok(lines.every((line) => String(line.note).includes("Desktop")));
    assert.throws(
      () => registry.registerBench({ name: "first", run: async () => [] }),
      /duplicate/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the CLI rejects missing baseline paths and unknown flags", () => {
  assert.throws(() => parseArgs(["--before"]), /path/);
  assert.throws(() => parseArgs(["--quik"]), /unknown/);
  assert.deepEqual(parseArgs([]).sizes, [1000, 12000, 50000]);
});

test("a comparison fails loudly when a benchmark's semantic results differ", async () => {
  await assert.rejects(
    runBenchmarks({
      sizes: [1000],
      runs: 1,
      variants: [
        { variant: "after", root: "." },
        { variant: "before", root: "." },
      ],
      benches: [
        {
          name: "changed-result",
          run: async (context) => [
            {
              read: "visible songs",
              medianMs: 0,
              p90Ms: 0,
              cpuMs: 0,
              rowsRead: 1,
              statements: 1,
              longestSyncTaskMs: 0,
              notifications: 0,
              resultKey: context.variant,
            },
          ],
        },
      ],
      emit: () => {},
    }),
    /worktree results differ/,
  );
});
