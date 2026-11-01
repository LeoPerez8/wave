/** Storage for the route tests: what R2 would hold, in memory. */

import type { UpdateStorage } from "./service.ts";

export const memoryStorage = ({ listPageSize = 1000 }: { listPageSize?: number } = {}) => {
  const objects = new Map<string, { data: Uint8Array; contentType: string }>();
  const storage: UpdateStorage = {
    list: async ({ prefix, cursor }) => {
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
      const start = Number(cursor ?? 0);
      const end = start + listPageSize;
      const page = keys.slice(start, end).map((key) => ({ key }));
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
    put: async (key: string, data: Uint8Array, contentType: string) => {
      objects.set(key, { data, contentType });
    },
    read: async (key: string) => {
      const object = objects.get(key);
      return object ? new TextDecoder().decode(object.data) : null;
    },
    remove: async (key: string) => {
      objects.delete(key);
    },
  };
};
