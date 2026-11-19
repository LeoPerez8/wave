import { readHomeFollow } from "./knownHomeFollow";
import { formatDate, type FollowCheckContext } from "@wave/core";
import { followShowsCheck } from "@wave/client/follows/followShowsCheck";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";

import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { showsConfigured, showsNotificationsEnabled } from "@/library/showNotifications";
import { showChecksToday } from "@/library/showChecksToday";
import { WaveNative, online } from "@/native/waveNative";
import { waveAccountErrorCode } from "@/native/waveAccount";
import { askWaveService, WaveServiceRefusal } from "@/sync/askWaveService";
import { waveSignedIn } from "@/sync/waveSignedIn";
import { currentLocalisation } from "@/localisation/localisation";
import { settledTurnEffect } from "@/lib/backgroundWork";
const savedListeners = new Set<() => void>();
/** Runs [listener] each time a check saves an artist's shows; returns the unsubscribe. */
export const subscribeFollowShows = (listener: () => void): (() => void) => {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
};
/**
 * The shared show check (`@wave/client`) over the phone's settings. The native module sends
 * each call to the sync service's Ticketmaster routes with the session JS never sees.
 */
const check = followShowsCheck({
  configured: showsConfigured,
  enabled: followedArtistsEnabled,
  country: currentFollowCountry,
  signedIn: waveSignedIn,
  online,
  checksToday: showChecksToday,
  ask: askWaveService,
  stops: (cause) => {
    const code = waveAccountErrorCode(cause);
    return (
      code === "ERR_WAVE_SIGNED_OUT" ||
      code === "ERR_WAVE_SESSION_ENDED" ||
      (cause instanceof WaveServiceRefusal && cause.status === 429 && cause.limit !== null)
    );
  },
  settle: settledTurnEffect,
  saved: () => {
    for (const listener of savedListeners) listener();
  },
  notifications: {
    enabled: showsNotificationsEnabled,
    post: (artist, show) => {
      const { language, strings } = currentLocalisation();
      WaveNative.postShowNotification?.(
        show.id,
        artist.name,
        `${formatDate(language, new Date(show.startsAt))}, ${show.city}, ${show.venue}`,
        show.ticketUrl,
        strings.shows.channel,
      );
    },
  },
});
/** Shared by Home, artist pages and the daily background task (`followCheckTask.ts`). */
export const checkFollowShows = (context: FollowCheckContext = "home", refreshCache = true) =>
  Effect.flatMap(LibraryStore, (store) => check(store, context)).pipe(
    Effect.tap((changed) =>
      changed && refreshCache && followedArtistsEnabled()
        ? Effect.tryPromise(readHomeFollow).pipe(Effect.ignore)
        : Effect.void,
    ),
  );
