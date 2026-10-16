import type { GlassSettings } from "./glassSettings.ts";

/**
 * The glass probe: a perf build's controlled comparison of what the glass costs
 * (issue #316, docs/performance/316-glass-frame-budget.md). The release runner
 * launches Wave with a probe (`--glass <probe>`), and every glass surface drops
 * the layers the probe names, so two runs differ by a single cost:
 *
 * - `live`: the glass as shipped (record the backdrop, blur, refract).
 * - `coalesced`: looks like `live`; the glass views over one backdrop share a
 *   single recording of it, re-recorded only when the backdrop changed.
 * - `blur`: no refraction. `live` − `blur` is the refraction shader.
 * - `record`: no blur either: the backdrop recorded and drawn as is.
 *   `blur` − `record` is the blur.
 * - `off`: no backdrop at all, only the tint and the rim. `record` − `off` is
 *   recording and redrawing the backdrop; `off` is the screen's own cost.
 *
 * Only perf builds read a probe; every other build is always `live`.
 */
export const GLASS_PROBES = ["live", "coalesced", "blur", "record", "off"] as const;
export type GlassProbe = (typeof GLASS_PROBES)[number];

/** The launch intent's string extra that carries the probe (`am start --es`). */
export const GLASS_PROBE_EXTRA = "wave.perf.glass";

/** What each probe keeps, for the runner's help. */
export const GLASS_PROBE_SUMMARY: Readonly<Record<GlassProbe, string>> = {
  live: "the glass as shipped: backdrop recorded every frame, blur, refraction",
  coalesced: "looks like live; one shared backdrop recording, redone only when the backdrop changed",
  blur: "backdrop and blur, no refraction",
  record: "backdrop drawn unblurred, no blur or refraction",
  off: "tint and rim only, no backdrop: the screen's own cost",
};

/** [raw] as a probe name; null when it isn't one (no probe asked for). */
export const readGlassProbe = (raw: unknown): GlassProbe | null =>
  GLASS_PROBES.find((probe) => probe === raw) ?? null;

/** What a glass view draws, as its native props take it. */
export interface GlassLayers {
  /** Whether it records the backdrop at all; false draws the tint and rim alone. */
  readonly backdrop: boolean;
  /** Blur radius in dp; 0 draws the backdrop unblurred. */
  readonly blur: number;
  /** Edge refraction in dp; 0 turns the shader off. */
  readonly refraction: number;
  /** Share one backdrop recording between the glass views over it (the candidate change). */
  readonly coalesce: boolean;
}

/** The layers a glass view draws for [settings] under [probe]. */
export const glassLayers = (settings: GlassSettings, probe: GlassProbe = "live"): GlassLayers => {
  const backdrop = probe !== "off";
  const blur = probe === "record" || probe === "off" ? 0 : settings.blur;
  const refraction = probe === "live" || probe === "coalesced" ? settings.refraction : 0;
  return { backdrop, blur, refraction, coalesce: probe === "coalesced" };
};
