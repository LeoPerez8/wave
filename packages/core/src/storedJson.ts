/**
 * A setting stored as a JSON object, as a plain record to read field by field.
 * Nothing stored, unreadable JSON or anything but an object reads as empty, so
 * each field falls back to its default.
 */
export const readStoredRecord = (stored: string | null): Readonly<Record<string, unknown>> => {
  if (stored === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return {};
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
};
