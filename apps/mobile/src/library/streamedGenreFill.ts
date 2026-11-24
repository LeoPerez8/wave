/**
 * Lookups failing this many times in a row end a run: the provider or the network is down
 * (offline, every lookup fails at once), and walking every pending video would only spend the
 * JS thread on the screen in front. The next run, after a play or Wave coming back, tries again.
 */
const FAILURES_ENDING_A_RUN = 3;

/** Sequential, bounded history fill. The caller schedules free turns and owns consent/lifetime. */
export interface StreamedGenreFillPorts {
  readonly enabled: () => boolean;
  readonly turn: () => Promise<void>;
  readonly page: (after: string) => Promise<readonly string[]>;
  readonly lookup: (videoId: string) => Promise<string | null>;
  readonly failed?: (videoId: string, cause: unknown) => void;
  readonly save: (videoId: string, genre: string | null) => Promise<void>;
}

export const fillStreamedGenres = async (ports: StreamedGenreFillPorts): Promise<void> => {
  let after = "";
  let failures = 0;
  while (ports.enabled()) {
    await ports.turn();
    if (!ports.enabled()) return;
    const page = await ports.page(after);
    if (page.length === 0) return;
    for (const videoId of page) {
      await ports.turn();
      if (!ports.enabled()) return;
      after = videoId;
      let genre: string | null;
      try {
        genre = await ports.lookup(videoId);
      } catch (cause) {
        ports.failed?.(videoId, cause);
        if (++failures >= FAILURES_ENDING_A_RUN) return;
        continue;
      }
      failures = 0;
      await ports.turn();
      await ports.save(videoId, genre);
    }
  }
};
