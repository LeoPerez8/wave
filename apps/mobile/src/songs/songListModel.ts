import { artworkUri } from "../catalog/artworkUri.ts";
import { songRowView, type SongListRowSource, type SongRowState } from "@wave/core";

/** The memoized leaf receives only display primitives and keyed action handlers. */
export const songRowPresentation = (
  source: SongListRowSource,
  state: SongRowState = {},
  key?: string,
) => {
  const view = songRowView(source, state);
  const queueRow = view.recycleType === "queueSong" || view.recycleType === "queueHistory";
  const fadedCover = view.recycleType === "queueHistory";
  return {
    rowKey: key ?? view.key,
    recycleType: view.recycleType,
    title: view.title,
    secondLine: view.secondLine,
    trailingText: view.trailingText,
    explicit: view.badges.explicit,
    downloaded: view.badges.downloaded,
    artworkUri:
      view.artwork.kind === "file"
        ? artworkUri(view.artwork.path, "thumbnail")
        : view.artwork.kind === "remote"
          ? view.artwork.url
          : undefined,
    /** The whole row at 45%; History in the Queue fades only its cover and title. */
    dimmed: view.dimmed && !fadedCover,
    fadedCover,
    /** The star and length cells; a Queue row has its own controls there. */
    trailing: !queueRow,
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
    /** [key] is the list's key for the row; the presentation's `rowKey` is it. */
    row(source: SongListRowSource, state: SongRowState = {}, key?: string): SongRowPresentation {
      const cacheKey = key ?? songRowView(source).key;
      const previous = cache.get(cacheKey);
      if (
        previous !== undefined &&
        sameFields(previous.source, source) &&
        sameState(previous.state, state)
      )
        return previous.shown;
      const shown = songRowPresentation(source, state, cacheKey);
      cache.delete(cacheKey);
      cache.set(cacheKey, { source, state, shown });
      if (cache.size > limit) cache.delete(cache.keys().next().value!);
      return shown;
    },
  };
};
