import type { FastAgainBench } from "./types.ts";

/** Modules export a bench; discovery registers them without running them. */
export const createBenchRegistry = () => {
  const benches = new Map<string, FastAgainBench>();
  return {
    registerBench(bench: FastAgainBench): void {
      if (benches.has(bench.name)) throw new Error(`duplicate bench: ${bench.name}`);
      benches.set(bench.name, bench);
    },
    registeredBenches: (): readonly FastAgainBench[] => [...benches.values()],
  };
};
export const { registerBench, registeredBenches } = createBenchRegistry();
