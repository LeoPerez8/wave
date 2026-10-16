import { readGlassProbe, type GlassProbe } from "@wave/core";

import { PERF_ENABLED, registerPerfMeta } from "@/perf/perf";
import { currentGlassSettings } from "@/settings/glass";

import { WaveGlass } from "./waveGlass";

/**
 * The glass probe this launch draws its glass with (Core `GLASS_PROBES`, issue
 * #316): the release runner's `--glass` puts it on the launch intent. Only a
 * perf build reads it; every other build draws the glass as shipped.
 */
let probe: GlassProbe | null = null;

/** Read once per launch, on first use, and kept: the glass never changes probe mid-run. */
export const glassProbe = (): GlassProbe => {
  if (!PERF_ENABLED) return "live";
  probe ??= readGlassProbe(WaveGlass.perfGlassProbe()) ?? "live";
  return probe;
};

// The run's metadata says which probe the glass drew and with which settings, so
// the runner can refuse a run whose glass isn't the one it asked for.
registerPerfMeta(
  "glass",
  () => {
    const settings = currentGlassSettings();
    return {
      probe: glassProbe(),
      blur: settings.blur,
      refraction: settings.refraction,
      tint: settings.tint,
      rim: settings.rim,
    };
  },
  true,
);
