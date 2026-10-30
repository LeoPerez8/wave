/** Sequential, bounded history fill. The caller schedules free turns and owns consent/lifetime. */
export interface StreamedGenreFillPorts {
  readonly enabled: () => boolean;
  readonly turn: () => Promise<void>;
  readonly page: (after: string) => Promise<readonly string[]>;
  readonly lookup: (videoId: string) => Promise<string | null>;
  readonly save: (videoId: string, genre: string | null) => Promise<void>;
}

export const fillStreamedGenres = async (ports: StreamedGenreFillPorts): Promise<void> => {
  let after = "";
  while (ports.enabled()) {
    await ports.turn();
    if (!ports.enabled()) return;
    const page = await ports.page(after);
    if (page.length === 0) return;
    for (const videoId of page) {
      await ports.turn();
      if (!ports.enabled()) return;
      // A failed request stops the run without recording a permanent miss.
      const genre = await ports.lookup(videoId);
      await ports.turn();
      await ports.save(videoId, genre);
      after = videoId;
    }
  }
};
