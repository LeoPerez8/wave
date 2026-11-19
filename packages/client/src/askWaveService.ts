/**
 * The sync service answered [status] instead of 200: a limit (with its name,
 * from `{ "error": "limit", "limit": … }`), a provider failing, or an older
 * service without the route.
 */
export class WaveServiceRefusal extends Error {
  readonly status: number;
  readonly limit: string | null;
  constructor(status: number, limit: string | null) {
    super(`HTTP ${status} from Wave's sync service`);
    this.status = status;
    this.limit = limit;
  }
}

/** The limit a refusal's [body] names, if it's `{ "error": "limit", "limit": … }`. */
const refusedLimit = (body: string): string | null => {
  try {
    const answer = JSON.parse(body) as { error?: unknown; limit?: unknown } | null;
    return answer?.error === "limit" && typeof answer.limit === "string" ? answer.limit : null;
  } catch {
    return null;
  }
};

/** One request with the Wave account's session, as the phone's native module and the desktop send it. */
export type WaveServiceRequest = (
  method: "GET",
  path: string,
  body: null,
) => Promise<{ readonly status: number; readonly body: string }>;

/**
 * The JSON the sync service's route [path] answers a GET with, sent by [request] with the
 * session. Rejects with `WaveServiceRefusal` for an answer that isn't 200, and with
 * [request]'s `ERR_WAVE_*` error when it sends nothing (signed out) or the session ended.
 */
export const askWaveService = async (
  request: WaveServiceRequest,
  path: string,
): Promise<unknown> => {
  const response = await request("GET", path, null);
  if (response.status !== 200)
    throw new WaveServiceRefusal(response.status, refusedLimit(response.body));
  return JSON.parse(response.body) as unknown;
};
