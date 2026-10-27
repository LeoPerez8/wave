import { fileUri } from "../lib/fileUri.ts";
import { songRowView, type SongListRowSource, type SongRowState } from "@wave/core";

/** The memoized leaf receives only display primitives and keyed action handlers. */
export const songRowPresentation = (source: SongListRowSource, state: SongRowState = {}) => {
  const view = songRowView(source, state);
  return {
    rowKey: view.key,
    recycleType: view.recycleType,
    title: view.title,
    secondLine: view.secondLine,
    trailingText: view.trailingText,
    explicit: view.badges.explicit,
    downloaded: view.badges.downloaded,
    artworkUri:
      view.artwork.kind === "file"
        ? fileUri(view.artwork.path)
        : view.artwork.kind === "remote"
          ? view.artwork.url
          : undefined,
    dimmed: view.dimmed,
    disabled: view.disabled,
    progress: view.progress,
    fileNotFound: view.fileNotFound,
    fileNotFoundIcon: view.fileNotFoundIcon,
    playing: view.playing,
    starred: view.starred,
    selecting: view.selecting,
    checked: "checked" in view.accessibilityState ? view.accessibilityState.checked : false,
    leading: view.leading.kind,
    number: "number" in view.leading ? view.leading.number : undefined,
    top: view.leading.kind === "rank" && view.leading.top,
    wideTrailing: state.trailingLabel !== undefined || state.countedPlays !== undefined,
    accessibilityRole: view.accessibilityRole,
    accessibilityLabel: view.accessibilityLabel,
  };
};
export type SongRowPresentation = ReturnType<typeof songRowPresentation>;

const sameFields = (a: object | null | undefined, b: object | null | undefined): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
};
const sameState = (a: SongRowState, b: SongRowState): boolean =>
  sameFields(a.leading, b.leading) &&
  sameFields(a.download, b.download) &&
  sameFields(
    { ...a, leading: undefined, download: undefined },
    { ...b, leading: undefined, download: undefined },
  );

/** Keeps only nearby rows; a long scroll cannot retain the whole Library. */
export const createSongListModel = (limit = 256) => {
  const cache = new Map<
    string,
    { source: SongListRowSource; state: SongRowState; shown: SongRowPresentation }
  >();
  return {
    identity(source: SongListRowSource) {
      const { key, recycleType } = songRowView(source);
      return { key, recycleType };
    },
    row(
      source: SongListRowSource,
      state: SongRowState = {},
      key = songRowView(source).key,
    ): SongRowPresentation {
      const previous = cache.get(key);
      if (
        previous !== undefined &&
        sameFields(previous.source, source) &&
        sameState(previous.state, state)
      )
        return previous.shown;
      const shown = songRowPresentation(source, state);
      cache.delete(key);
      cache.set(key, { source, state, shown });
      if (cache.size > limit) cache.delete(cache.keys().next().value!);
      return shown;
    },
  };
};
