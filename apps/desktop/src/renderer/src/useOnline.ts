import { useSyncExternalStore } from "react";

const subscribe = (update: () => void) => {
  addEventListener("online", update);
  addEventListener("offline", update);
  return () => {
    removeEventListener("online", update);
    removeEventListener("offline", update);
  };
};

export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine);
