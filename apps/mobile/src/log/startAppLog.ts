// Imported first thing (index.ts), before Expo Router and the app, so the log
// catches what goes wrong while they load too.
import { installAppLog } from "./appLog";

installAppLog();
