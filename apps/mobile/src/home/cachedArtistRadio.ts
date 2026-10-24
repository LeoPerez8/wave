/** Shared by Artist and Genre mixes: ordered radio cache, then one bounded live read. */
import { catalogSeedKey } from "@wave/core";
import * as Effect from "effect/Effect";
import type { SongRadioPage } from "../playback/songRadioSession.ts";
import type { createRadioPageCatalog } from "../ytmusic/radioPageCatalog.ts";
import { sharedRead, type SharedRead } from "../lib/sharedRead.ts";
import { withRadioDeadline } from "../lib/radioDeadline.ts";

const MIX_RADIO_DEADLINE_MS = 8000;
export const artistRadioCacheId = (name: string): string => `artist:${catalogSeedKey(name)}`;
type Artist = { readonly name: string; readonly browseId?: string };

export const createCachedArtistRadioReader = <E, R, RN>({
  cache,
  live,
  note,
}: {
  readonly cache: Pick<ReturnType<typeof createRadioPageCatalog>, "getFresh" | "put">;
  readonly live: (artist: Artist) => Effect.Effect<SongRadioPage | null, E, R>;
  readonly note: (name: string, page: SongRadioPage) => Effect.Effect<void, never, RN>;
}) => {
  const pending = new Map<string, SharedRead<SongRadioPage | null, R | RN>>();
  return (artist: Artist): Effect.Effect<SongRadioPage | null, unknown, R | RN> =>
    Effect.gen(function* () {
      const id = artistRadioCacheId(artist.name);
      const cached = cache.getFresh(id);
      if (cached !== null) return cached;
      let reading = pending.get(id);
      if (reading === undefined) {
        reading = sharedRead(
          Effect.gen(function* () {
            const page = yield* withRadioDeadline(live(artist), MIX_RADIO_DEADLINE_MS);
            if (page !== null) {
              cache.put(id, page);
              yield* Effect.forkDetach(note(artist.name, page));
            }
            return page;
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (pending.get(id) === reading) pending.delete(id);
              }),
            ),
          ),
        );
        pending.set(id, reading);
      }
      return yield* reading.get;
    });
};
