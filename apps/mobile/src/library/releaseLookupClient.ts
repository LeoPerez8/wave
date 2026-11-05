import {
  deezerRefused,
  releaseBatchSplit,
  releaseBatches,
  releaseRequestDelay,
  releaseTitleQuery,
  type ReleaseServices,
} from "@wave/core";

export interface ReleaseHttp {
  (
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: () => Promise<unknown> }>;
}

type Host = "deezer" | "musicbrainz";

const BASE: Record<Host, string> = {
  deezer: "https://api.deezer.com",
  musicbrainz: "https://musicbrainz.org/ws/2",
};

/**
 * Deezer's and MusicBrainz's requests for the release-date lookup (Core's `ReleaseServices`):
 * one queue per host, so one host's wait never holds the other's requests, each paced by Core's
 * `releaseRequestDelay` from when its last request started. Once [active] is false, a queued
 * request throws instead of going out. Deezer's not-found answers (its error object, any code
 * but a refusal's, Core's `deezerRefused`) come back as they are, holding no data.
 */
export const releaseLookupClient = (
  http: ReleaseHttp,
  wait: (ms: number) => Promise<void>,
  now = Date.now,
  active = () => true,
): ReleaseServices => {
  const last: Record<Host, number> = { deezer: -Infinity, musicbrainz: -Infinity };
  const queues: Record<Host, Promise<unknown>> = {
    deezer: Promise.resolve(),
    musicbrainz: Promise.resolve(),
  };
  const perform = async (host: Host, path: string): Promise<unknown> => {
    await wait(releaseRequestDelay(host, last[host], now()));
    if (!active()) throw new Error("Lookup paused");
    last[host] = now();
    const response = await http(`${BASE[host]}${path}`, {
      "User-Agent": "Wave/1.0 (https://github.com/LeoPerez8/wave)",
      Accept: "application/json",
    });
    if (response.status === 414) throw new RangeError("Query too long");
    if (response.status !== 200) throw new Error(`Release lookup HTTP ${response.status}`);
    const body = await response.json();
    if (host === "deezer" && deezerRefused(body)) throw new Error("Release lookup refused");
    return body;
  };
  const request = (host: Host, path: string): Promise<unknown> => {
    const result = queues[host].then(() => perform(host, path));
    queues[host] = result.catch(() => {});
    return result;
  };
  const recordings = async (codes: readonly string[]): Promise<unknown[]> => {
    const responses: unknown[] = [];
    const read = async (batch: readonly string[], offset = 0): Promise<void> => {
      const query = encodeURIComponent(batch.map((code) => `isrc:${code}`).join(" OR "));
      let body: unknown;
      try {
        body = await request(
          "musicbrainz",
          `/recording/?query=${query}&fmt=json&limit=100&offset=${offset}`,
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
    search: (title, artist) =>
      request("deezer", `/search?q=${encodeURIComponent(`${title} ${artist}`)}&limit=10`),
    album: (id) => request("deezer", `/album/${id}`),
    recordings,
    titled: (title, artist) =>
      request(
        "musicbrainz",
        `/recording/?query=${encodeURIComponent(releaseTitleQuery({ title, artist }))}&fmt=json&limit=25`,
      ),
  };
};
