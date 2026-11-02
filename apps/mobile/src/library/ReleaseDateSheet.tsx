import {
  formatReleaseDate,
  readTypedReleaseDate,
  releaseShownDate,
  tagWriteFailureLine,
  typedReleaseTag,
  type TagWriteFile,
  type TagWriteStep,
  type TypedReleaseDateFields,
} from "@wave/core";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";
import { presentOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { useThemeColor } from "@/theme/useThemeColor";

import { publishLibraryChange } from "./libraryChanges";
import { LibraryStore, type SongRow } from "./LibraryStore";
import { releaseDates, releaseSongKey } from "./releaseAnswers";
import { appRuntime } from "./runtime";
import { setTypedReleaseDate, typedReleaseDates } from "./typedReleaseDates";

/** A song Release date is about: a Library song ([trackId]), or a YT Music or unsearched one. */
export interface ReleaseDateSong {
  readonly title: string;
  readonly artist: string;
  /** The Library song, whose index and file take the date too; null for a streamed song. */
  readonly trackId: number | null;
  /** The original-date tag, as the index has it. */
  readonly original?: string | null | undefined;
  readonly year?: number | null | undefined;
}

/** The date [song] shows and sorts by (Core's `releaseShownDate`), null when none is known. */
const shownDate = (song: ReleaseDateSong): string | null => {
  const key = releaseSongKey(song);
  return releaseShownDate({
    typed: typedReleaseDates.get()[key],
    original: song.original,
    answer: releaseDates.get()[key],
    year: song.year,
  });
};

/** Release Date's menu entry for [song]: with the date it has, when it has one. */
export const releaseDateMenuLabel = (song: ReleaseDateSong): string => {
  const { language, strings } = currentLocalisation();
  const date = shownDate(song);
  return date === null
    ? strings.itemActions.labels.releaseDate
    : strings.itemActions.releaseDateIs(formatReleaseDate(date, language));
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The phone's date today, `YYYY-MM-DD`. */
const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** What the screen ends with: a date to save, the typed one cleared, or nothing (cancelled). */
type ReleaseDateChoice = { readonly date: string | null } | null;

/** The screen's fields filled with [date] (`1985`, `1985-06` or `1985-06-21`), else empty. */
const fieldsOf = (date: string | null): TypedReleaseDateFields => {
  const [year = "", month = "", day = ""] = date?.split("-") ?? [];
  return { year, month, day };
};

function ReleaseDateCard({
  initial,
  typed,
  finish,
}: {
  initial: string | null;
  typed: boolean;
  finish: (choice: ReleaseDateChoice) => void;
}) {
  const [accent, secondary] = useThemeColor(["accent", "secondary"]);
  const { strings } = useLocalisation();
  const text = strings.playlists;
  const [fields, setFields] = useState(() => fieldsOf(initial));
  const read = readTypedReleaseDate(fields, today());
  const save = () => {
    if (read.ok) finish({ date: read.date });
  };
  const field = (name: keyof TypedReleaseDateFields, label: string, length: number) => (
    <View style={{ flex: length }}>
      <Text className="font-sans text-footnote text-secondary">{label}</Text>
      <TextInput
        value={fields[name]}
        onChangeText={(value) => setFields((before) => ({ ...before, [name]: value }))}
        autoFocus={name === "year"}
        selectTextOnFocus
        keyboardType="number-pad"
        maxLength={length}
        returnKeyType="done"
        onSubmitEditing={save}
        accessibilityLabel={label}
        placeholderTextColor={secondary}
        selectionColor={accent}
        cursorColor={accent}
        className="font-sans text-title3 text-foreground"
        style={{ height: grid.row, padding: 0 }}
      />
      <Hairline />
    </View>
  );
  return (
    <>
      <CatalogLine>{text.releaseDateTitle}</CatalogLine>
      <View className="flex-row" style={{ gap: CELL * 2 }}>
        {field("year", text.releaseDateYear, 4)}
        {field("month", text.releaseDateMonth, 2)}
        {field("day", text.releaseDateDay, 2)}
      </View>
      {/* The line is reserved so the actions don't jump when a problem appears. */}
      <Text
        accessibilityLiveRegion="polite"
        className="font-sans text-footnote text-secondary"
        style={{ minHeight: CELL * 3, paddingTop: CELL / 2 }}
      >
        {!read.ok && read.problem === "impossible"
          ? text.releaseDateImpossible
          : text.releaseDateHint}
      </Text>
      <View className="flex-row justify-end" style={{ gap: CELL * 3 }}>
        {typed ? (
          <TextButton label={text.releaseDateClear} onPress={() => finish({ date: null })} />
        ) : null}
        <TextButton label={text.cancel} onPress={() => finish(null)} />
        <TextButton label={text.releaseDateSave} onPress={save} disabled={!read.ok} />
      </View>
    </>
  );
}

/**
 * Writes the typed [date] into [path]'s original-date tag, replacing the file's (null takes
 * it out): Core's `typedReleaseTag`, unlike a found date, which never replaces one. False
 * when the file didn't take it; the app log says why.
 */
const writeTypedTag = async (path: string, date: string | null): Promise<boolean> => {
  const failed = (
    cause: unknown,
    step: TagWriteStep | null = null,
    file: TagWriteFile | null = null,
  ) => {
    console.warn(
      `[wave] ${tagWriteFailureLine({ path, origin: "typedReleaseDate", step, file, cause })}`,
    );
    return false;
  };
  try {
    const written = await WaveNative.replaceOriginalDate(path, date);
    if (!("failed" in written)) return written.originalDate !== "notWritten";
    const { step, exception, message, fileExists, fileBytes } = written.failed;
    return failed(Object.assign(new Error(message), { name: exception }), step, {
      exists: fileExists,
      bytes: fileBytes,
    });
  } catch (cause) {
    return failed(cause);
  }
};

/** The playlists text in the language Wave reads in now. */
const text = () => currentLocalisation().strings.playlists;

/**
 * Keeps [date] as [song]'s typed release date, or clears it (null): in the synced typed dates,
 * so it wins here and on the owner's other phones; for a Library song in the index too, and in
 * its file, replacing the original date there. Clearing forgets the lookup's answer, so the
 * song is looked up again. A file that can't take the date says so; the index keeps it.
 */
const saveTypedDate = async (song: ReleaseDateSong, date: string | null): Promise<void> => {
  const key = releaseSongKey(song);
  const before = typedReleaseDates.get()[key] ?? null;
  if (!setTypedReleaseDate(key, date)) {
    void showToast(text().releaseDateFull);
    return;
  }
  if (date === null) {
    const { [key]: _forgotten, ...answers } = releaseDates.get();
    releaseDates.set(answers);
  }
  const { trackId } = song;
  if (trackId === null) return;
  let saved: { readonly path: string | null } | null;
  try {
    saved = await appRuntime.runPromise(
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
      LibraryStore.use((store) => store.saveTypedReleaseDate(trackId, date)),
    );
  } catch {
    setTypedReleaseDate(key, before);
    void showToast(text().releaseDateCouldntSave);
    return;
  }
  publishLibraryChange({ kind: "tracks", ids: [trackId] });
  const path = saved?.path ?? null;
  const tag = typedReleaseTag({ date, hasFile: path !== null });
  if (path !== null && tag !== null && !(await writeTypedTag(path, tag.date)))
    void showToast(text().releaseDateNotInFile);
};

/**
 * Release date for [song]: a small screen to type a year, a year and month, or a full date
 * (Core's `readTypedReleaseDate`), filled with the date it shows, or to clear a typed one.
 */
export const openReleaseDate = (song: ReleaseDateSong): void => {
  const typed = typedReleaseDates.get()[releaseSongKey(song)] ?? null;
  void presentOverlay<ReleaseDateChoice>({
    label: currentLocalisation().strings.playlists.releaseDateTitle,
    align: "top",
    dismissed: null,
    render: (finish) => (
      <ReleaseDateCard initial={shownDate(song)} typed={typed !== null} finish={finish} />
    ),
  }).then((choice) => {
    if (choice !== null) void saveTypedDate(song, choice.date);
  });
};

/** A Library song as Release date takes it. */
export const libraryReleaseSong = (song: SongRow): ReleaseDateSong => ({
  title: song.title,
  artist: song.artist,
  trackId: song.id,
  original: song.releaseDate,
  year: song.year,
});

/**
 * A YT Music or unsearched song as Release date takes it, by its own title and first artist, as
 * its playlist entry is dated; [track], the Library's song it is by now, takes the date too.
 */
export const streamedReleaseSong = (
  song: { readonly title: string; readonly artists: readonly string[] },
  track: SongRow | null = null,
): ReleaseDateSong => ({
  title: song.title,
  artist: song.artists[0] ?? "",
  trackId: track?.id ?? null,
  original: track?.releaseDate,
  year: track?.year,
});
