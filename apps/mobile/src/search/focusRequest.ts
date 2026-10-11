/**
 * Tapping the Search tab asks for the search field, so the keyboard comes up
 * without a second tap. The request waits for the screen when the tap is what
 * brings it up, and reaches it straight away when it's already showing.
 * Arriving any other way (Back from a result) doesn't ask.
 */
/** How long a request waits for the screen. */
const WAITS_MS = 1000;

let requestedAt: number | null = null;
const listeners = new Set<() => void>();

export function requestSearchFocus(): void {
  requestedAt = Date.now();
  for (const listener of listeners) listener();
}

/** Whether a request is waiting; reading it answers it. */
export function takeSearchFocusRequest(): boolean {
  const requested = requestedAt !== null && Date.now() - requestedAt < WAITS_MS;
  requestedAt = null;
  return requested;
}

export function onSearchFocusRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
