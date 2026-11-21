import { CROSSFADE, STREAM_BUFFER_MINUTES } from "@wave/core";
import { useEffect, useState } from "react";
import type { PlaybackSettings as Settings } from "../../shared/playbackSettings.ts";
import { ShuffleKindSetting } from "./ShuffleKinds.tsx";
import { OutputSetting } from "./OutputSetting.tsx";
import { labels, text } from "./text.ts";

/**
 * Settings › Playback: Crossfade, Normalize Volume, Buffer, Don't Play Explicit and Continue with
 * Magic Queue, the account's values when signed in. A change applies from the next song.
 */
export function PlaybackSettings({ onError }: { readonly onError: () => void }) {
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => {
    let live = true;
    void window.wave.settings
      .playback()
      .then((value) => {
        if (live) setSettings(value);
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [onError]);
  if (settings === undefined) return null;
  const change = (next: Partial<Settings>) => {
    setSettings({ ...settings, ...next });
    void window.wave.settings.setPlayback(next).catch(onError);
  };
  const crossfade = (seconds: number) =>
    seconds === 0 ? text.settings.off : text.settings.seconds(seconds);
  return (
    <div className="mt-8 max-w-3xl">
      <h2 className="text-lg font-semibold">{labels.playback}</h2>
      <section className="mt-4 border-y border-separator py-3">
        <div className="flex items-center gap-4">
          <label htmlFor="crossfade" className="w-40 shrink-0">
            {text.settings.crossfade}
          </label>
          <input
            id="crossfade"
            type="range"
            className="min-w-0 flex-1 accent-accent"
            min={CROSSFADE.min}
            max={CROSSFADE.max}
            step={CROSSFADE.step}
            value={settings.crossfadeSeconds}
            aria-valuetext={crossfade(settings.crossfadeSeconds)}
            onChange={(event) => change({ crossfadeSeconds: Number(event.target.value) })}
          />
          <output htmlFor="crossfade" className="w-24 shrink-0 text-right text-secondary">
            {crossfade(settings.crossfadeSeconds)}
          </output>
        </div>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.asASongEndsOnItsOwn}</p>
      <section className="mt-6 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.normalizeVolume}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-accent"
            checked={settings.normalizeVolume}
            onChange={(event) => change({ normalizeVolume: event.target.checked })}
          />
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.playsEverySongAtAboutTheSame}</p>
      <section className="mt-6 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.buffer}</span>
          <select
            value={settings.bufferMinutes}
            onChange={(event) =>
              change({ bufferMinutes: Number(event.target.value) as Settings["bufferMinutes"] })
            }
          >
            {STREAM_BUFFER_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {text.settings.minutes(minutes)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.howMuchOfAStreamedSongWave}</p>
      <ShuffleKindSetting
        kind={settings.shuffleKind}
        onChange={(shuffleKind) => change({ shuffleKind })}
      />
      <section className="mt-6 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.dontPlayExplicit}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-accent"
            checked={settings.dontPlayExplicit}
            onChange={(event) => change({ dontPlayExplicit: event.target.checked })}
          />
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">
        {text.settings.skipsSongsMarkedExplicitByYouTubeMusic}
      </p>
      <section className="mt-6 border-y border-separator py-3">
        <label className="flex items-center justify-between gap-4">
          <span>{text.settings.continueWithMagicQueue}</span>
          <input
            type="checkbox"
            role="switch"
            className="size-4 accent-accent"
            checked={settings.continueQueue}
            onChange={(event) => change({ continueQueue: event.target.checked })}
          />
        </label>
      </section>
      <p className="mt-2 text-sm text-secondary">{text.settings.whenAQueueRunsOutWaveContinues}</p>
      <OutputSetting onError={onError} />
    </div>
  );
}
