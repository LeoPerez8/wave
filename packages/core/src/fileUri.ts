/** A local file URI, preserving addresses that already name their scheme. */
export const fileUri = (path: string | null | undefined): string | undefined =>
  path == null || path === ""
    ? undefined
    : /^[a-z][a-z0-9+.-]*:/i.test(path)
      ? path
      : `file://${path}`;
