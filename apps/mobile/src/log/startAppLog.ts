// Imported first thing (index.ts), before Expo Router and the app, so the log
// catches what goes wrong while they load too.
import { installAppLog } from "./appLog";
// [DEBUG-5d1a] Temporary: see the heartbeat below.
import { WaveAppLog } from "@/native/waveAppLog";

installAppLog();

// [DEBUG-5d1a] Temporary: a JS timer's heartbeat, which the native screen-off probe
// (ScreenOffProbe.kt) reports. Remove with it.
const debugHeartbeat = (): void => WaveAppLog?.debugJsHeartbeat?.();
debugHeartbeat();
setInterval(debugHeartbeat, 30_000);
