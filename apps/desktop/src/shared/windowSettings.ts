/** Device-local settings; they never join the Wave account's preferences. */
export interface WindowSettings {
  readonly closeQuits: boolean;
  readonly startWithSystem: boolean;
}

export const validWindowSettings = (value: unknown): value is Partial<WindowSettings> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.entries(value).every(
    ([key, item]) =>
      (key === "closeQuits" || key === "startWithSystem") && typeof item === "boolean",
  );
