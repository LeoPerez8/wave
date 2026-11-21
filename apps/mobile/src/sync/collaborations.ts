import { collaborationService } from "@wave/client/sync/collaborationService";
import { WaveAccount } from "@/native/waveAccount";

/**
 * The sync service's collaborative-playlist routes on the phone (`@wave/client`'s
 * `collaborationService`), sent by the native module with the session JS never sees, as the
 * account's push and pull are.
 */
export const collaborations = collaborationService(WaveAccount);
