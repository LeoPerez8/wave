/**
 * Tapping the Search tab asks for the search field, so the keyboard comes up
 * without a second tap. The request waits for the screen when the tap is what
 * brings it up, and reaches it straight away when it's already mounted.
 * Arriving any other way (Back from a result) doesn't ask. How long a request
 * may wait, and how the field is focused, is Core's `stepSearchFocus`.
 */

/** When the last request not yet taken was made (`performance.now()`), or null. */
let requestedAt: number | null = null;
const listeners = new Set<(at: number) => void>();

export function requestSearchFocus(): void {
  const at = performance.now();
  if (listeners.size === 0) {
    requestedAt = at;
    return;
  }
  requestedAt = null;
  for (const listener of listeners) listener(at);
}

/** When a request no screen has taken yet was made, or null; reading it takes it. */
export function takeSearchFocusRequest(): number | null {
  const at = requestedAt;
  requestedAt = null;
  return at;
}

/** Calls [listener] with each request's time while subscribed; returns how to stop. */
export function onSearchFocusRequest(listener: (at: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
