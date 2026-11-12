import {
  indexListDownloads,
  type AppLanguage,
  type ListDownloadsScope,
  type YtDownloadJournalJob,
} from "@wave/core";
import type { ExternalStore } from "../lib/externalStore.ts";
import type { DownloadListKey, DownloadListMembers } from "../library/db/listDownloadMembers.ts";

interface Sources {
  readonly journal: Pick<ExternalStore<readonly YtDownloadJournalJob[]>, "get" | "subscribe">;
  readonly subscribeMembership: (changed: () => void) => () => void;
  readonly read: (scope: ListDownloadsScope) => Promise<DownloadListMembers>;
}

/**
 * One scoped membership read for all visible lists. Byte ticks reuse it; only
 * changed lines notify their own listeners. Nothing follows the journal when
 * every consumer is hidden, and the membership cache leaves with them.
 */
export const createListDownloadProgressStore = (sources: Sources) => {
  const listeners = new Map<DownloadListKey, Set<() => void>>();
  let lines = new Map<DownloadListKey, { en: string | null; "pt-BR": string | null }>();
  let members: DownloadListMembers = new Map();
  let index = indexListDownloads([]);
  let scope = "";
  let loadedScope = "";
  let revision = 0;
  let loadedRevision = -1;
  let generation = 0;
  let reading = false;
  let queued = false;
  let stops: readonly (() => void)[] = [];

  const publish = (): void => {
    const next = new Map<DownloadListKey, { en: string | null; "pt-BR": string | null }>();
    if (index.active)
      for (const [key, entries] of members) {
        const en = index.line(entries, "en");
        if (en !== null) next.set(key, { en, "pt-BR": index.line(entries, "pt-BR") });
      }
    const before = lines;
    lines = next;
    for (const [key, subscribers] of listeners) {
      if (
        before.get(key)?.en === next.get(key)?.en &&
        before.get(key)?.["pt-BR"] === next.get(key)?.["pt-BR"]
      )
        continue;
      for (const listener of subscribers) listener();
    }
  };

  const update = (): void => {
    if (listeners.size === 0) return;
    const next = indexListDownloads(sources.journal.get(), index);
    if (next === index && scope === loadedScope && revision === loadedRevision) return;
    index = next;
    scope = JSON.stringify([index.videoIds, index.savedPaths]);
    // Existing membership can show a cancellation or a landed song immediately.
    publish();
    if (!index.active || (scope === loadedScope && revision === loadedRevision) || reading) return;
    reading = true;
    const askedScope = scope;
    const askedRevision = revision;
    const askedGeneration = generation;
    void sources
      .read(index)
      .then((answer) => {
        if (askedGeneration !== generation) return;
        if (askedScope === scope && askedRevision === revision) {
          members = answer;
          loadedScope = askedScope;
          loadedRevision = askedRevision;
          publish();
        }
      })
      .catch(() => {
        // Keep the last completed answer. The next journal or Library event retries.
      })
      .finally(() => {
        if (askedGeneration !== generation) return;
        reading = false;
        if (askedScope !== scope || askedRevision !== revision) schedule();
      });
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      update();
    });
  };

  return {
    get: (key: DownloadListKey, language: AppLanguage): string | null =>
      lines.get(key)?.[language] ?? null,
    subscribe: (key: DownloadListKey, listener: () => void): (() => void) => {
      const subscribers = listeners.get(key) ?? new Set<() => void>();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      if (stops.length === 0) {
        stops = [
          sources.journal.subscribe(schedule),
          sources.subscribeMembership(() => {
            revision++;
            schedule();
          }),
        ];
        schedule();
      }
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) listeners.delete(key);
        if (listeners.size !== 0) return;
        for (const stop of stops) stop();
        stops = [];
        generation++;
        reading = false;
        members = new Map();
        lines = new Map();
        loadedScope = "";
        loadedRevision = -1;
      };
    },
  };
};
