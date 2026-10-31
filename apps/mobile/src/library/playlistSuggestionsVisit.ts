/**
 * A playlist visit's suggestions: the session, and what it holds, belong to the
 * visit rather than to the list's footer, so they load from the opening on and
 * outlive the section scrolling out of sight or being recycled away.
 */
import {
  PLAYLIST_SAVED_OFFERS,
  playlistOfferGoneSteps,
  playlistOfferHeld,
  playlistRecommendationsSteps,
  playlistRecommendationSession,
  playlistSuggestionsLine,
  playlistSuggestionsSightLine,
  playlistSuggestionsSightWatch,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { lookedUpProfileOf } from "@/home/artistGenres";
import { afterPaint } from "@/lib/afterPaint";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { makeExternalStore, type ExternalStore } from "@/lib/externalStore";
import { recommendationTurn, recommendationTurnEffect } from "@/lib/recommendationWork";
import { sightOf, type ScreenSight } from "@/lib/sight";
import { runSteps } from "@/lib/stepped";
import { appLog } from "@/log/appLog";
import { online as phoneOnline } from "@/native/waveNative";

import { LibraryStore, type PlaylistEntryRow, type SongRow } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import { followPlaylistRecommendations } from "./playlistRecommendationVisit";
import {
  playlistRecommendationGraph,
  playlistRecommendationInput,
} from "./playlistRecommendationSource";
import { readSavedOffers, writeSavedOffers } from "./playlistSavedOffers";
import { playlistSuggestionRadios, playlistSuggestionSeeds } from "./playlistSuggestionRadios";
import { playlistsChanged } from "./playlists";
import { appRuntime } from "./runtime";

let nextOffer = 0;

/** Fewer eligible suggestions left than this, and a refill reads the radios' next pages. */
const LOW = 10;

export const createPlaylistSuggestionsVisit = (playlistId: number) => {
  const announcingAcceptance = makeExternalStore(false);
  // What a tapped slot's placeholder says until its action ends ("Adding Song"), by slot;
  // any other placeholder is loading a replacement.
  const busyLabels = makeExternalStore<ReadonlyMap<number, string>>(new Map());
  // Keep held offers readable if another offer's refill no longer finds their Library row.
  const saved = readSavedOffers(playlistId);
  // The rows of what's saved, spares among them, whichever read last held them.
  let savedRows = saved.rows;
  const libraryRows = makeExternalStore<ReadonlyMap<string, SongRow>>(saved.rows);
  const latestRows = makeExternalStore<ReadonlyMap<string, SongRow>>(new Map());
  // Date.now(): the list notices the section's sight on the UI thread, whose clock is this one.
  const sightWatch = playlistSuggestionsSightWatch({
    now: Date.now,
    report: (timing) => appLog("info", "WaveTiming", playlistSuggestionsSightLine(timing)),
  });
  // The first renewal is the one opening the playlist asked for; its line counts from here.
  let openedAt: number | undefined = performance.now();
  // This visit's radio readers: each radio's live first page is read once a visit.
  const visitId = `playlist:${playlistId}:${Date.now().toString(36)}-${++nextOffer}`;
  let remaining = Number.POSITIVE_INFINITY;
  const rowOf = (id: string) =>
    latestRows.get().get(id) ?? libraryRows.get().get(id) ?? savedRows.get(id);
  const session = playlistRecommendationSession({
    saved: {
      offers: saved.tracks,
      online: phoneOnline,
      write: (offers) => {
        const rows = new Map<string, SongRow>();
        for (const { id } of offers) {
          const row = rowOf(id);
          if (row !== undefined) rows.set(id, row);
        }
        savedRows = rows;
        writeSavedOffers(playlistId, offers, (id) => rows.get(id));
      },
    },
    gone: (input, signal) =>
      appRuntime.runPromise(
        runSteps(playlistOfferGoneSteps(input.playlist, input.sources), recommendationTurnEffect),
        { signal },
      ),
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${++nextOffer}`,
    read: (signal) => {
      sightWatch.waiting("read");
      return appRuntime.runPromise(
        Effect.gen(function* () {
          const input = yield* playlistRecommendationInput(playlistId);
          const graph = yield* playlistRecommendationGraph;
          // Source rows are retained for the five visible offers only, never a copy of the Library.
          latestRows.set(input.songById);
          const seeds = playlistSuggestionSeeds(playlistId, input.playlist);
          const online = phoneOnline();
          const pages = yield* playlistSuggestionRadios(visitId, seeds, {
            online,
            low: remaining < LOW,
          });
          sightWatch.waiting(null);
          return {
            playlist: input.playlist,
            sources: {
              ...input,
              pages,
              seeds,
              graph,
              profileOf: lookedUpProfileOf,
              online,
            },
          };
        }),
        { signal },
      );
    },
    rank: async (input, signal) => {
      sightWatch.waiting("rank");
      const ranked = await appRuntime
        .runPromise(
          runSteps(
            playlistRecommendationsSteps(input.playlist, input.sources, PLAYLIST_SAVED_OFFERS),
            recommendationTurnEffect,
          ),
          { signal },
        )
        .catch((error: unknown) => {
          // A cancelled rank must not keep the whole Library index reachable from this visit.
          latestRows.set(new Map());
          throw error;
        });
      sightWatch.waiting(null);
      remaining = ranked.length;
      const held = new Map<string, SongRow>();
      const keep = (id: string) => {
        const row = latestRows.get().get(id);
        if (row !== undefined) held.set(id, row);
      };
      for (const offer of ranked) keep(offer.track.id);
      for (const offer of session.get().slots) if (offer !== null) keep(offer.track.id);
      latestRows.set(held);
      // The rows showing take what was just read, offers the ranking dropped among them.
      libraryRows.update((previous) => {
        if (![...previous].some(([id, row]) => (held.get(id) ?? row) !== row)) return previous;
        return new Map([...previous].map(([id, row]) => [id, held.get(id) ?? row]));
      });
      return ranked;
    },
    dismiss: (offer) =>
      appRuntime.runPromise(
        Effect.gen(function* () {
          const store = yield* LibraryStore;
          return yield* store.dismissPlaylistRecommendation(playlistId, offer);
        }),
      ),
    accept: (offer) =>
      appRuntime
        .runPromise(
          Effect.gen(function* () {
            const store = yield* LibraryStore;
            return yield* store.acceptPlaylistRecommendation(playlistId, offer);
          }),
        )
        .then((added) => {
          if (added) {
            // Both notification functions are synchronous; this Add already refills its slot.
            announcingAcceptance.set(true);
            try {
              playlistsChanged([playlistId]);
            } finally {
              announcingAcceptance.set(false);
            }
          }
          return added;
        }),
    // The tap's placeholder paints before the write; the replacement's read
    // gives rendering its frame when due (Core's `PlaylistRecommendationTurn`).
    yieldTurn: (kind) => (kind === "paint" ? afterPaint() : recommendationTurn()),
    timed: {
      now: () => performance.now(),
      report: (timing) => {
        const sinceOpen = openedAt === undefined ? undefined : performance.now() - openedAt;
        openedAt = undefined;
        appLog("info", "WaveTiming", playlistSuggestionsLine(timing, sinceOpen));
        const { offers, failed } = timing;
        void afterPaint().then(() => sightWatch.shown({ offers, failed }));
      },
    },
  });
  // Saved offers are showing from the start: the wait for them is over, and what runs next renews.
  const shownAtOnce = session.get().slots.length;
  if (shownAtOnce > 0) {
    openedAt = undefined;
    sightWatch.shown({ offers: shownAtOnce, failed: false });
  }
  // Here, not in the section: slots can change with the section unmounted.
  let heldSlots = session.get().slots;
  session.subscribe(() => {
    const { slots } = session.get();
    if (slots === heldSlots) return;
    heldSlots = slots;
    libraryRows.update((previous) => {
      const held = new Map<string, SongRow>();
      const wanted = new Set(
        slots.flatMap((offer) => (offer?.track.source === "library" ? [offer.track.id] : [])),
      );
      // At most five lookups; don't synchronously index/copy the complete source on publication.
      for (const id of wanted) {
        const row = latestRows.get().get(id) ?? previous.get(id) ?? savedRows.get(id);
        if (row !== undefined) held.set(id, row);
      }
      return held;
    });
  });
  return {
    session,
    libraryRows,
    busyLabels,
    /**
     * The playlist's entries as just read: an offer it now holds leaves, and only its
     * slot fills. Other recordings of the song leave once a renewal's read has found them.
     */
    playlistRead: (items: readonly PlaylistEntryRow[]): void => {
      session.leave(
        playlistOfferHeld(
          items.map((entry) =>
            entry.source === "library"
              ? { id: String(entry.track.id) }
              : entry.source === "stream"
                ? { videoId: entry.song.videoId }
                : {},
          ),
        ),
      );
    },
    /**
     * Loads while [screen] is in sight and the section is [wanted]; the section's
     * own sight only times the wait. Returns how to stop, cancelling what's under way.
     */
    follow: (
      screen: ScreenSight,
      wanted: Pick<ExternalStore<boolean>, "get" | "subscribe">,
      sectionSight: Pick<ExternalStore<number | null>, "get" | "subscribe">,
    ): (() => void) => {
      const sight = sightOf(
        { holds: screen.visible, subscribe: screen.subscribe },
        {
          holds: wanted.get,
          subscribe: (listener) => wanted.subscribe(() => listener(wanted.get())),
        },
      );
      const following = followPlaylistRecommendations(session, {
        playlistId,
        sight,
        start: (signal) => {
          sightWatch.waiting("settle");
          return appRuntime.runPromise(settledTurnEffect, { signal });
        },
        // The visit follows the write's cause (#599): source changes revalidate even when
        // playlist IDs stay the same, once the playlist is in sight and settled. Catalog writes
        // (its own radios' among them) don't: the suggestions read their radios, not the catalog.
        subscribe: onLibraryChange,
        ignore: (change) => change.kind === "playlists" && announcingAcceptance.get(),
      });
      // Now Playing or Find over a wait starts it over.
      const listSight = () => {
        const at = sectionSight.get();
        if (at !== null && sight.visible()) sightWatch.inSight(at);
      };
      listSight();
      const stopList = sectionSight.subscribe(listSight);
      const stopSight = sight.subscribe((visible) => {
        if (!visible) sightWatch.hidden();
        else if (sectionSight.get() !== null) sightWatch.inSight();
      });
      return () => {
        following.dispose();
        stopList();
        stopSight();
      };
    },
  };
};

export type PlaylistSuggestionsVisit = ReturnType<typeof createPlaylistSuggestionsVisit>;
