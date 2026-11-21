/** A list page's Find field: narrows the page's table as the user types (the phone's pull-down Find). */
import { findNoMatch, findPlaceholder, type FindableListKind } from "@wave/core";
import type { BrowseKind } from "../../shared/browse.ts";
import { Icon } from "./Icon.tsx";
import { language } from "./text.ts";

const FINDABLE: Partial<Record<BrowseKind, FindableListKind>> = {
  songs: "songs",
  albums: "albums",
  artists: "artists",
  genres: "genres",
  favorites: "favorites",
  playlists: "playlists",
  playlist: "playlist",
  artist: "artist",
  genre: "genre",
};

/** The list Core names [kind]'s Find by, when its page has a Find field. */
export const findableList = (kind: string): FindableListKind | undefined =>
  FINDABLE[kind as BrowseKind];

/** What [kind]'s table says when its Find finds nothing ("No songs match"). */
export const findNoMatchFor = (kind: string): string | undefined => {
  const list = findableList(kind);
  return list && findNoMatch(list, language);
};

export function FindField({
  list,
  value,
  onChange,
  onLeave,
}: {
  readonly list: FindableListKind;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Esc: the field is cleared and the focus goes back to the list. */
  readonly onLeave: () => void;
}) {
  const placeholder = findPlaceholder(list, language);
  return (
    <label className="search-field find-field" title={placeholder}>
      <Icon name="search" />
      {/* A text field, not a searchbox: the window's one searchbox is the Library Search. */}
      <input
        type="text"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onChange("");
          onLeave();
        }}
      />
    </label>
  );
}
