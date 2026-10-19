/**
 * Starting an artist's radio (docs/spec.md, "Artist mixes"): from where it
 * started last time (Core's `artistRadioStart`, remembered by the artist
 * page's browse id), so a build doesn't read the whole artist page for it;
 * from the page's Start radio when nothing is remembered, remembering where
 * it starts. A start YouTube Music refuses is forgotten and the page read
 * once. Kept free of Expo so it runs under plain Node tests; the app's
 * reader is `artistRadio` (`ytArtistPage.ts`).
 */
import {
  artistRadioStart,
  withArtistRadioStart,
  type ArtistRadioStarts,
  type YtRadioStart,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { NativeYtArtistRadio, NativeYtRadioPage } from "@/native/waveYtMusic";

/** What starting an artist radio needs: the remembered starts and YouTube Music's two ways in. */
export interface ArtistRadioSources<E, R> {
  readonly starts: {
    readonly get: () => ArtistRadioStarts;
    readonly set: (starts: ArtistRadioStarts) => void;
  };
  /** The radio's first page from [start], without the artist page (`YtMusic.radio`). */
  readonly fromStart: (start: YtRadioStart) => Effect.Effect<NativeYtRadioPage, E, R>;
  /** The radio's first page from the artist page, with where it started (`YtMusic.artistRadio`). */
  readonly fromPage: (browseId: string) => Effect.Effect<NativeYtArtistRadio, E, R>;
}

/**
 * The first page of the radio of the artist whose page is [browseId], read
 * as the module says. Fails as the read failed: offline or with YT Music off
 * a remembered start stays for the next build.
 */
export const artistRadioReader =
  <E extends { readonly reason: string }, R>({
    starts,
    fromStart,
    fromPage,
  }: ArtistRadioSources<E, R>) =>
  (browseId: string): Effect.Effect<NativeYtRadioPage, E, R> =>
    Effect.gen(function* () {
      const start = artistRadioStart(starts.get(), browseId);
      if (start !== null) {
        const read = yield* Effect.result(fromStart(start));
        if (Result.isSuccess(read)) return read.success;
        if (read.failure.reason !== "failed") return yield* Effect.fail(read.failure);
        starts.set(withArtistRadioStart(starts.get(), browseId, null));
      }
      const { start: found, ...page } = yield* fromPage(browseId);
      starts.set(withArtistRadioStart(starts.get(), browseId, found));
      return page;
    });
