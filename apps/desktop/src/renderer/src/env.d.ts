import type { WaveBridge } from "../../shared/bridge.ts";

declare global {
  interface Window {
    readonly wave: WaveBridge;
  }
}
