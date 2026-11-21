/** A one-shot request for a mounted screen's existing anchored editor. */
const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const armed = new Set<string>();

/** Arms a request before navigating; the destination consumes it on focus. */
export const armAnchoredMenu = (id: string): void => {
  armed.add(id);
};

/** Opens the request only when the destination screen has focused. */
export const openArmedAnchoredMenu = (id: string): void => {
  if (!armed.delete(id)) return;
  requestAnchoredMenu(id);
};

export const requestAnchoredMenu = (id: string): void => {
  const registered = listeners.get(id);
  const listener = registered?.values().next().value as (() => void) | undefined;
  if (listener === undefined) pending.add(id);
  else listener();
};

export const listenForAnchoredMenu = (id: string, open: () => void): (() => void) => {
  const registered = listeners.get(id) ?? new Set<() => void>();
  listeners.set(id, registered);
  registered.add(open);
  if (pending.delete(id)) open();
  return () => {
    registered.delete(open);
    if (registered.size === 0) listeners.delete(id);
  };
};
