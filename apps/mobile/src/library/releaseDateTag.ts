import { releaseTagNotWrittenLine, tagWriteFailureLine } from "@wave/core";

import { WaveNative } from "@/native/waveNative";

/**
 * Writes [date] into [path]'s original-date tag: a found date only into a file without one, a
 * typed date ([typed]) over the file's, null taking the file's out (`writeOriginalDate`,
 * `replaceOriginalDate` in wave-native). False when the file didn't take it; the app log says
 * why, and the index keeps the date whatever happened.
 */
export const writeReleaseDateTag = async (
  path: string,
  date: string | null,
  typed: boolean,
): Promise<boolean> => {
  const origin = typed ? "typedReleaseDate" : "releaseDate";
  try {
    const written =
      typed || date === null
        ? await WaveNative.replaceOriginalDate(path, date)
        : await WaveNative.writeOriginalDate(path, date);
    if (!("failed" in written)) {
      if (written.originalDate !== "notWritten") return true;
      if (date !== null) console.warn(`[wave] ${releaseTagNotWrittenLine(path, date)}`);
      return false;
    }
    const { step, exception, message, fileExists, fileBytes } = written.failed;
    const cause = Object.assign(new Error(message), { name: exception });
    console.warn(
      `[wave] ${tagWriteFailureLine({ path, origin, step, file: { exists: fileExists, bytes: fileBytes }, cause })}`,
    );
  } catch (cause) {
    console.warn(`[wave] ${tagWriteFailureLine({ path, origin, step: null, file: null, cause })}`);
  }
  return false;
};
