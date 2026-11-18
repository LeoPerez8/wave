/** Storage for the route tests: what R2 and the Durable Objects would hold, in memory. */

import { type CountNamespace, type CountStorage, RequestCounts } from "./limits.ts";
import type { UpdateStorage } from "./service.ts";

export const memoryStorage = ({
  listPageSize = 1000,
  clock = () => new Date(),
}: {
  listPageSize?: number;
  /** When a put happens, which R2 gives each object as `uploaded`. */
  clock?: () => Date;
} = {}) => {
  const objects = new Map<string, { data: Uint8Array; contentType: string; uploaded: Date }>();
  /** Takes the scripts' bucket's arguments and R2's binding's alike. */
  const put = async (
    key: string,
    data: Uint8Array | string,
    type: string | { readonly httpMetadata: { readonly contentType: string } },
  ) => {
    objects.set(key, {
      data: typeof data === "string" ? new TextEncoder().encode(data) : data,
      contentType: typeof type === "string" ? type : type.httpMetadata.contentType,
      uploaded: clock(),
    });
  };
  const storage: UpdateStorage = {
    put,
    list: async ({ prefix, cursor }) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
      const start = Number(cursor ?? 0);
      const end = start + listPageSize;
      const page = keys
        .slice(start, end)
        .map((key) => ({ key, uploaded: objects.get(key)?.uploaded ?? new Date(0) }));
      return end < keys.length
        ? { objects: page, truncated: true, cursor: String(end) }
        : { objects: page, truncated: false };
    },
    get: async (key) => {
      const object = objects.get(key);
      if (!object) return null;
      const { data, contentType } = object;
      return {
        body: new Blob([new Uint8Array(data)]).stream(),
        text: async () => new TextDecoder().decode(data),
        httpMetadata: { contentType },
      };
    },
  };
  return {
    ...storage,
    put,
    read: async (key: string) => {
      const object = objects.get(key);
      return object ? new TextDecoder().decode(object.data) : null;
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
};

/**
 * The `RequestCounts` namespace in memory: one object per name, as Cloudflare keeps them, each
 * with its own storage and alarm. `runAlarms` fires those due by `at`.
 */
export const memoryCounts = () => {
  const objects = new Map<
    string,
    { counts: RequestCounts; values: Map<string, unknown>; alarm: number | null }
  >();
  const objectFor = (name: string) => {
    const existing = objects.get(name);
    if (existing) return existing;
    const values = new Map<string, unknown>();
    const storage: CountStorage = {
      get: async <T>(key: string) => values.get(key) as T | undefined,
      put: async (key, value) => {
        values.set(key, structuredClone(value));
      },
      setAlarm: async (at) => {
        object.alarm = at;
      },
      deleteAll: async () => {
        values.clear();
      },
    };
    const object = { counts: new RequestCounts({ storage }), values, alarm: null as number | null };
    objects.set(name, object);
    return object;
  };
  /** How many calls reached the objects. */
  let calls = 0;
  const namespace: CountNamespace<string> = {
    idFromName: (name) => name,
    get: (name) => ({
      fetch: (input, init) => {
        calls += 1;
        return objectFor(name).counts.fetch(new Request(input, init));
      },
    }),
  };
  return {
    namespace,
    calls: () => calls,
    /** Every name an object was made under, and everything stored, as text. */
    held: () => JSON.stringify([...objects].map(([name, { values }]) => [name, [...values]])),
    stored: () => [...objects.values()].reduce((sum, { values }) => sum + values.size, 0),
    runAlarms: async (at: number) => {
      for (const object of objects.values()) {
        if (object.alarm !== null && object.alarm <= at) {
          object.alarm = null;
          await object.counts.alarm();
        }
      }
    },
  };
};
