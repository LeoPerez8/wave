import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { WaveGlass, type FrameStats } from "./waveGlass";

/** Windows of 500 ms kept for the rolling average (5 s). */
const WINDOWS = 10;

const summarize = (windows: readonly FrameStats[]) => {
  const frames = windows.reduce((sum, w) => sum + w.frames, 0);
  const seconds = windows.reduce((sum, w) => sum + w.frames / Math.max(w.fps, 0.001), 0);
  return {
    fps: frames / Math.max(seconds, 0.001),
    avgFrameMs: windows.reduce((sum, w) => sum + w.avgFrameMs * w.frames, 0) / Math.max(frames, 1),
    worstP95Ms: Math.max(...windows.map((w) => w.p95FrameMs)),
    missed: windows.reduce((sum, w) => sum + w.missedDeadlines, 0),
    missedPercent: (100 * windows.reduce((sum, w) => sum + w.missedDeadlines, 0)) / Math.max(frames, 1),
    frames,
  };
};

/**
 * Frame-time readout from Android FrameMetrics (RenderThread + GPU time per
 * frame), with a 5-second rolling summary to copy into docs/glass-spike.md.
 * `resetKey` clears the history, e.g. when switching technique.
 */
export function FrameStatsHud({ resetKey }: { resetKey: string }) {
  const [windows, setWindows] = useState<FrameStats[]>([]);

  useEffect(() => {
    setWindows([]);
  }, [resetKey]);

  useEffect(() => {
    WaveGlass.startFrameStats();
    const subscription = WaveGlass.addListener("onFrameStats", (stats) => {
      setWindows((previous) => [...previous.slice(-(WINDOWS - 1)), stats]);
    });
    return () => {
      subscription.remove();
      WaveGlass.stopFrameStats();
    };
  }, []);

  const latest = windows.at(-1);
  const summary = windows.length > 0 ? summarize(windows) : null;

  return (
    <View className="gap-0.5 rounded-xl bg-black/70 px-3 py-2">
      <Text className="font-sans text-footnote font-semibold text-white">
        {latest
          ? `${latest.fps.toFixed(0)} fps now · ${latest.refreshRate.toFixed(0)} Hz display`
          : "Waiting for frames… scroll to measure"}
      </Text>
      {summary ? (
        <Text className="font-sans text-caption text-white/80">
          {`5 s: ${summary.fps.toFixed(1)} fps · avg ${summary.avgFrameMs.toFixed(1)} ms · p95 ${summary.worstP95Ms.toFixed(1)} ms · late ${summary.missed}/${summary.frames} (${summary.missedPercent.toFixed(1)}%)`}
        </Text>
      ) : null}
    </View>
  );
}
