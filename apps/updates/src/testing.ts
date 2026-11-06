/** Storage for the route tests: what R2 would hold, in memory. */

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
