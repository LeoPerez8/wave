/** The `file://` URI of the file at [path] (a cover, say); undefined for none. */
export const fileUri = (path: string | null | undefined): string | undefined =>
  path == null ? undefined : `file://${path}`;
