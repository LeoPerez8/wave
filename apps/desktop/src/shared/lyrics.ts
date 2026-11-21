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

/**
 * What shows under a song's lyrics while Translate is on (`window.wave.lyrics.translation`):
 * one translation per lyric line, in order (null where none shows); the lyrics are already in
 * the app's language (Google's code for it); the request `failed` (Try Again asks once more);
 * or `off`: Translate is off or the song has no words, and nothing was sent.
 */
export type SongTranslation =
  | { readonly kind: "off" | "failed" }
  | { readonly kind: "translated"; readonly lines: readonly (string | null)[] }
  | { readonly kind: "sameLanguage"; readonly language: string };
