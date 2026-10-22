import {
  pickYtArtist,
  ytArtistAnswerKept,
  ytArtistLookup,
  type YtArtistCandidate,
  type YtArtistPage,
  type YtArtistSaved,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { artistOpeningRequest } from "./artistOpeningRequest.ts";

/** The actual artist lookup/save workflow; transport and persistence are its ports. */
export const fetchArtistAnswer = <S extends YtSong, E, R>(
  name: string,
  saved: YtArtistSaved<S> | null,
  ports: {
    readonly canSend?: () => boolean;
    readonly search: (query: string) => Effect.Effect<readonly YtArtistCandidate[], E, R>;
    readonly page: (browseId: string) => Effect.Effect<YtArtistPage<S>, E, R>;
    readonly saved: Effect.Effect<YtArtistSaved<S> | null, never, R>;
    readonly save: (answer: YtArtistSaved<S>) => Effect.Effect<void, never, R>;
  },
): Effect.Effect<YtArtistSaved<S>, E | { readonly reason: "offline" | "failed" }, R> =>
  Effect.gen(function* () {
    const guarded = <A>(effect: Effect.Effect<A, E, R>) =>
      artistOpeningRequest(ports.canSend ?? (() => true), effect);
    const lookup = ytArtistLookup(name, saved);
    if (lookup === null) return yield* Effect.fail({ reason: "failed" as const });
    const browseId =
      lookup.kind === "page"
        ? lookup.browseId
        : pickYtArtist(name, yield* guarded(ports.search(lookup.query)));
    const checkedAt = Date.now();
    const answer: YtArtistSaved<S> =
      browseId === null
        ? { outcome: "unmatched", checkedAt }
        : { outcome: "found", checkedAt, browseId, page: yield* guarded(ports.page(browseId)) };
    const kept = ytArtistAnswerKept(yield* ports.saved, answer, checkedAt);
    if (kept !== answer) return kept;
    yield* guarded(ports.save(answer));
    return answer;
  });
