import type { SearchKind } from "@wave/core";

/** Which of Search's capped groups show all their results: each kind's, and Lyrics'. */
export interface ResultExpansion {
  readonly kinds: ReadonlySet<SearchKind>;
  readonly lyrics: boolean;
}

/** Every group capped: how a search starts. */
export const NO_EXPANSION: ResultExpansion = { kinds: new Set(), lyrics: false };

/** [kind]'s Show all was tapped. */
export const showAllOf = (expansion: ResultExpansion, kind: SearchKind): ResultExpansion =>
  expansion.kinds.has(kind)
    ? expansion
    : { ...expansion, kinds: new Set(expansion.kinds).add(kind) };

/** Lyrics' Show all was tapped. */
export const showAllLyricsOf = (expansion: ResultExpansion): ResultExpansion =>
  expansion.lyrics ? expansion : { ...expansion, lyrics: true };

/** The field changed to [text]: clearing it caps every group again; refining keeps them. */
export const expansionAfterTyping = (expansion: ResultExpansion, text: string): ResultExpansion =>
  text.trim() === "" ? NO_EXPANSION : expansion;
