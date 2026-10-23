/** The kept library-import queue's public runner; transport/storage remain supplied by the app. */
import {
  nextYtLibraryRead,
  isYtLibraryReadQueued,
  ytLibraryDownloadsToQueue,
  type YtLibraryBatch,
  type YtLibraryRead,
} from "@wave/core";
interface Ports {
  readonly turn: () => Promise<void>;
  readonly batch: () => YtLibraryBatch;
  readonly prune: () => Promise<void>;
  readonly settle: (id: number) => Promise<void>;
  readonly download: (read: YtLibraryRead) => Promise<void>;
  readonly fill: (read: YtLibraryRead) => Promise<string | null>;
  readonly paused: (read: YtLibraryRead, reason: string) => void;
}
/** Does not consume a paused/failed transport answer. The caller retains its single-run lock. */
export const resumeLibraryReads = async (ports: Ports): Promise<void> => {
  await ports.turn();
  await ports.prune();
  for (const read of ytLibraryDownloadsToQueue(ports.batch())) {
    await ports.turn();
    if (!isYtLibraryReadQueued(ports.batch(), read)) continue;
    await ports.settle(read.playlistId);
    await ports.turn();
    if (!isYtLibraryReadQueued(ports.batch(), read)) continue;
    await ports.download(read);
  }
  for (;;) {
    await ports.turn();
    const next = nextYtLibraryRead(ports.batch());
    if (next === undefined) return;
    const reason = await ports.fill(next);
    if (reason !== null) {
      ports.paused(next, reason);
      return;
    }
  }
};
