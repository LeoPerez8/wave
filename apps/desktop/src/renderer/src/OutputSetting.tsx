import { useState } from "react";
import type { OutputSettings } from "../../shared/playbackSettings.ts";
import { text } from "./text.ts";
import { useEverySecond } from "./useEverySecond.ts";

/** The `<select>` value of the system's default; a device's id is never empty. */
const SYSTEM_DEFAULT = "";

/**
 * Settings › Playback › Output: the system's outputs, System default first. The list follows
 * what is plugged in; the output picked stays in it while it is away.
 */
export function OutputSetting({ onError }: { readonly onError: () => void }) {
  const [settings, setSettings] = useState<OutputSettings>();
  useEverySecond(() => window.wave.settings.outputs(), setSettings);
  if (settings === undefined) return null;
  const { outputs, chosen } = settings;
  const pick = (id: string) =>
    void window.wave.settings
      .setOutput(id === SYSTEM_DEFAULT ? null : id)
      .then(setSettings)
      .catch(onError);
  return (
    <>
      <section className="mt-6 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.desktopOutput.output}</span>
          <select
            className="min-w-0 max-w-sm"
            value={chosen?.id ?? SYSTEM_DEFAULT}
            onChange={(event) => pick(event.target.value)}
          >
            <option value={SYSTEM_DEFAULT}>{text.desktopOutput.systemDefault}</option>
            {outputs.map((output) => (
              <option key={output.id} value={output.id}>
                {output.name}
              </option>
            ))}
            {chosen !== null && !chosen.connected && (
              <option value={chosen.id} disabled>
                {text.desktopOutput.notConnected(chosen.name)}
              </option>
            )}
          </select>
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">
        {chosen !== null && !chosen.connected
          ? text.desktopOutput.away(chosen.name)
          : text.desktopOutput.hint}
      </p>
    </>
  );
}
