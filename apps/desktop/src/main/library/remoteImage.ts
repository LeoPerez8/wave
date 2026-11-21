/** Reads a previously approved image URL as a data URL for the sandboxed window. */
export const readRemoteImage = async (
  fetch: typeof globalThis.fetch,
  url: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string | null> => {
  try {
    const response = await fetch(url, {
      redirect: "error",
      credentials: "omit",
      ...(signal === undefined ? {} : { signal }),
    });
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || !/^image\/[a-z0-9.+-]+$/i.test(type)) return null;
    if (Number(response.headers.get("content-length") ?? 0) > maxBytes) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
};
