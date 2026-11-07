/**
 * The query check the sync service's fixed proxy routes share
 * (`geniusProxy.ts`, `ticketmasterProxy.ts`): a route takes exactly the
 * parameters the phone sends, each once.
 */

/** [params]' values when it holds exactly [names], each once; null otherwise. */
export const exactParams = (params: URLSearchParams, names: readonly string[]): string[] | null => {
  const keys = [...params.keys()];
  if (keys.length !== names.length || names.some((name) => params.getAll(name).length !== 1))
    return null;
  return names.map((name) => params.get(name) ?? "");
};
