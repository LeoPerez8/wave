import type { GeniusReferent, Lyrics } from "@wave/core";

/**
 * What the Lyrics view shows for a song (`window.wave.lyrics.song`): its lyrics, `none` for
 * "No lyrics", or `failed` when a source couldn't be reached (Try again asks once more).
 */
export type SongLyrics = Lyrics | { readonly kind: "failed" };

/** The Genius text and annotations for the Lyrics view. */
export type SongGenius =
  | { readonly kind: "hidden" | "signIn" | "miss" | "failed" }
  | {
      readonly kind: "answer";
      readonly about: string | null;
      readonly referents: readonly GeniusReferent[];
    };

export type GeniusPhase = "read" | "translate";
