import { releaseBatches, releaseBatchSplit, releaseRequestDelay } from "@wave/core";

export interface ReleaseHttp {
  (
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: () => Promise<unknown> }>;
}
/** One queue for both hosts; the clock advances when a request actually starts. */
export const releaseLookupClient = (
  http: ReleaseHttp,
  wait: (ms: number) => Promise<void>,
  now = Date.now,
  active = () => true,
) => {
  const last = { deezer: -Infinity, musicbrainz: -Infinity };
  const perform = async (host: "deezer" | "musicbrainz", path: string): Promise<unknown> => {
    await wait(releaseRequestDelay(host, last[host], now()));
    if (!active()) throw new Error("Lookup paused");
    last[host] = now();
    const response = await http(
      `${host === "deezer" ? "https://api.deezer.com" : "https://musicbrainz.org/ws/2"}${path}`,
      {
        "User-Agent": "Wave/1.0 (https://github.com/LeoPerez8/wave)",
        Accept: "application/json",
      },
    );
    if (response.status === 414) throw new RangeError("Query too long");
    if (response.status !== 200) throw new Error(`Release lookup HTTP ${response.status}`);
    const body = await response.json();
    if (body && typeof body === "object" && "error" in body)
      throw new Error("Release lookup refused");
    return body;
  };
  let queue: Promise<unknown> = Promise.resolve();
  const request = (host: "deezer" | "musicbrainz", path: string): Promise<unknown> => {
    const result = queue.then(() => perform(host, path));
    queue = result.catch(() => {});
    return result;
  };
  const recordings = async (codes: readonly string[]): Promise<unknown[]> => {
    const responses: unknown[] = [];
    const read = async (batch: readonly string[], offset = 0): Promise<void> => {
      let body: unknown;
      try {
        body = await request(
          "musicbrainz",
          `/recording/?query=${encodeURIComponent(batch.map((c) => `isrc:${c}`).join(" OR "))}&fmt=json&limit=100&offset=${offset}`,
        );
      } catch (error) {
        if (!(error instanceof RangeError) || batch.length === 1) throw error;
        const middle = Math.floor(batch.length / 2);
        await read(batch.slice(0, middle));
        await read(batch.slice(middle));
        return;
      }
      const split = releaseBatchSplit(batch, body);
      if (split) {
        for (const half of split) await read(half);
        return;
      }
      responses.push(body);
      const count = Number((body as { count?: number }).count ?? 0);
      // Even a single prolific ISRC must be paged completely.
      if (offset + 100 < count) await read(batch, offset + 100);
    };
    for (const batch of releaseBatches(codes)) await read(batch);
    return responses;
  };
  return {
    search: (title: string, artist: string) =>
      request("deezer", `/search?q=${encodeURIComponent(`${title} ${artist}`)}&limit=10`),
    album: (id: number) => request("deezer", `/album/${id}`),
    recordings,
  };
};
