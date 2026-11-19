import { askWaveService as ask } from "@wave/client/askWaveService";
import { WaveAccount } from "@/native/waveAccount";

export { WaveServiceRefusal } from "@wave/client/askWaveService";

/**
 * The JSON the sync service's route [path] answers a GET with, sent by the native module with
 * the session JS never sees (`@wave/client`'s `askWaveService`).
 */
export const askWaveService = (path: string): Promise<unknown> =>
  ask((method, route, body) => WaveAccount.request(method, route, body), path);
