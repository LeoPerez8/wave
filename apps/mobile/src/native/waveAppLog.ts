import type { LogDevice } from "@wave/core";
import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * The app log's file (`modules/wave-native`, `log/AppLogFile.kt`): `files/logs/wave.log`,
 * which native code writes to as well. Core's `appLog.ts` decides what goes in it.
 */
declare class WaveAppLogModule extends NativeModule {
  /** Appends formatted entries off the JS thread; resolves the log's size in bytes. */
  append(text: string): Promise<number>;
  /** Appends at once, on the JS thread, for a fatal error; returns the log's size in bytes. */
  appendNow(text: string): number;
  read(): Promise<string>;
  /** Drops the oldest `bytes` bytes of the log (Core's `trimLog`). */
  dropHead(bytes: number): Promise<void>;
  /** The phone and Wave build, for the exported file's header. */
  device(): LogDevice;
  /** Writes `header` and the log to a `.txt` named `fileName` and opens the share sheet with it. */
  share(header: string, fileName: string): Promise<void>;
  /** The route showing, which a freeze's entry names (`log/NativeLog.kt`). */
  setScreen(path: string): void;
  /** Throws an uncaught Kotlin exception on the main thread: Settings › Developer's debug trigger. */
  crash(): void;
}

/**
 * Null in a build without it. The log starts before anything else (index.ts), so a
 * missing module must leave Wave running, only without a log.
 */
export const WaveAppLog = requireOptionalNativeModule<WaveAppLogModule>("WaveAppLog");
