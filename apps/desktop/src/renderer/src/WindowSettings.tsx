import { useEffect, useState } from "react";
import type { WindowSettings as Settings } from "../../shared/windowSettings.ts";
import { labels, text } from "./text.ts";

export function WindowSettings({ onError }: { readonly onError: () => void }) {
  const [settings, setSettings] = useState<Settings>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void window.wave.settings
      .window()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(onError);
    return () => {
      active = false;
    };
  }, [onError]);
  const change = async (value: Partial<Settings>) => {
    setSaving(true);
    try {
      setSettings(await window.wave.settings.setWindow(value));
    } catch {
      onError();
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <h2>{labels.window}</h2>
      {(["closeQuits", "startWithSystem"] as const).map((key) => (
        <label className="setting-switch" key={key}>
          <input
            type="checkbox"
            checked={settings?.[key] ?? false}
            disabled={!settings || saving}
            onChange={(event) => void change({ [key]: event.target.checked })}
          />
          <span>{text.desktopWindow[key]}</span>
        </label>
      ))}
      <p className="secondary setting-hint">{text.desktopWindow.startHint}</p>
    </>
  );
}
