/**
 * The Wi-Fi pre-download's list (docs/spec.md, YT Music, Wi-Fi pre-download):
 * the start of each mix Home shows, as its section's level blends it (Core's
 * `mixPreDownload`), handed over to the native job (`schedulePreDownload`)
 * whenever it changes: a build or refresh saved, Undo, a level changed, YT
 * Music turned off (an empty list). The job fetches them into the audio
 * cache on Wi-Fi with battery not low, without JS.
 */
import { mixPreDownload, type BlendedDiscoverMix, type DiscoverMixesSection } from "@wave/core";

import { appLog } from "@/log/appLog";
import { WaveYtMusic } from "@/native/waveYtMusic";

import type { MixSectionId } from "./discoverMixLevel";

/** The sections in the order their mixes take turns. */
const ORDER: readonly MixSectionId[] = ["artist-mixes", "genre-mixes"];

/** What each section shows now; a section not seen yet (or still on its skeleton) has none. */
const shown = new Map<MixSectionId, readonly BlendedDiscoverMix[]>();

/** The list last handed over, so the same one isn't again. */
let handedOver: string | null = null;

let pending: ReturnType<typeof setTimeout> | null = null;

/** Both sections render at once: their lists go over as one, a moment later. */
const SETTLE_MS = 2_000;

const handOver = (): void => {
  pending = null;
  const videoIds = mixPreDownload(ORDER.map((id) => shown.get(id) ?? []));
  const key = videoIds.join(",");
  if (key === handedOver) return;
  handedOver = key;
  WaveYtMusic.schedulePreDownload(videoIds).catch((error: unknown) => {
    handedOver = null;
    appLog(
      "warn",
      "WavePreDownload",
      `Couldn't hand over the Wi-Fi pre-download: ${String(error)}`,
    );
  });
};

/**
 * Home's mix section [id] shows [section]: the list follows. A row Home
 * doesn't draw ([drawn] false: removed, though an empty Library's Magic
 * Queue still builds Artist mixes) has nothing fetched ahead.
 */
export const noteMixesShown = (
  id: MixSectionId,
  section: DiscoverMixesSection,
  drawn: boolean,
): void => {
  if (drawn && section.kind === "skeleton") return;
  shown.set(id, drawn && section.kind === "mixes" ? section.mixes : []);
  if (pending !== null) clearTimeout(pending);
  pending = setTimeout(handOver, SETTLE_MS);
};
