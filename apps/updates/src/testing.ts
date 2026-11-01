/** Storage for the route tests: what R2 would hold, in memory. */

import type { UpdateStorage } from "./service.ts";

export const memoryStorage = () => {
  const objects = new Map<string, { data: Uint8Array; contentType: string }>();
  const storage: UpdateStorage = {
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
