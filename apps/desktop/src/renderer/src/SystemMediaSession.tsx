import { useEffect, useRef, useState } from "react";
import type { PlayerView } from "../../shared/playerView.ts";

/** Chromium needs an active media element even though the Rust engine plays Wave's audio. */
const silentAudio = () => {
  const bytes = new ArrayBuffer(44 + 80_000);
  const view = new DataView(bytes);
  const word = (offset: number, text: string) => {
    for (let n = 0; n < text.length; n++) view.setUint8(offset + n, text.charCodeAt(n));
  };
  word(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  word(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, 80_000, true);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
};

/** Windows fallback selected after the Souvlaki SMTC check; no second audio engine. */
export function SystemMediaSession({
  view,
  refresh,
}: {
  readonly view: PlayerView | undefined;
  /** Reads the player again now: a hidden window's timers are throttled. */
  readonly refresh: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const latest = useRef(view);
  useEffect(() => {
    latest.current = view;
  });
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void window.wave.system.mediaBackend().then((backend) => {
      if (active) setEnabled(backend === "chromium");
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!enabled || !("mediaSession" in navigator)) return;
    const url = silentAudio();
    const element = new Audio(url);
    element.loop = true;
    audio.current = element;
    const playback = window.wave.playback;
    const run = (action: Promise<unknown>) => void action.then(refresh).catch(() => undefined);
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => run(playback.play()),
      pause: () => run(playback.pause()),
      stop: () => run(playback.pause()),
      nexttrack: () => run(playback.command({ type: "next" })),
      previoustrack: () => run(playback.command({ type: "previous" })),
      seekto: (event) => {
        if (event.seekTime !== undefined) run(playback.seek(event.seekTime * 1000));
      },
      seekforward: (event) =>
        run(
          playback.seek(
            Math.min(
              latest.current?.status.durationMs ?? 0,
              (latest.current?.status.positionMs ?? 0) + (event.seekOffset ?? 10) * 1000,
            ),
          ),
        ),
      seekbackward: (event) =>
        run(
          playback.seek(
            Math.max(0, (latest.current?.status.positionMs ?? 0) - (event.seekOffset ?? 10) * 1000),
          ),
        ),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler);
      } catch {
        /* OS does not expose this action. */
      }
    }
    return () => {
      element.pause();
      element.removeAttribute("src");
      element.load();
      URL.revokeObjectURL(url);
      audio.current = undefined;
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      for (const action of Object.keys(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action as MediaSessionAction, null);
        } catch {
          /* Unsupported action. */
        }
      }
    };
  }, [enabled, refresh]);
  const current = view?.current;
  const title = current?.title;
  const artist = current?.artist;
  const album = current?.album;
  const hash = current?.artworkHash;
  const artworkUrl = current?.artworkUrl;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const metadata = (src: string | null) =>
      new MediaMetadata({
        title: title ?? "",
        artist: artist ?? "",
        album: album ?? "",
        artwork: src ? [{ src }] : [],
      });
    navigator.mediaSession.metadata = title === undefined ? null : metadata(null);
    const cover = hash
      ? window.wave.library.artwork(hash, false)
      : artworkUrl
        ? window.wave.yt.artwork(artworkUrl)
        : Promise.resolve(null);
    void cover
      .then((src) => {
        if (active && title !== undefined) navigator.mediaSession.metadata = metadata(src);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled, title, artist, album, hash, artworkUrl]);
  // Chromium reports the session as playing while its element plays, whatever the page declares,
  // so the silent element follows Wave's state. It plays once per session to make the session
  // exist, so a queue restored paused still answers the Play key.
  const state = view?.status.state;
  const hasSong = !!current;
  const started = useRef(false);
  useEffect(() => {
    const element = audio.current;
    if (!enabled || !element) return;
    const session = navigator.mediaSession;
    if (!hasSong) {
      element.pause();
      session.playbackState = "none";
      return;
    }
    const playing = state === "playing";
    session.playbackState = playing ? "playing" : "paused";
    if (!playing && started.current) {
      element.pause();
      return;
    }
    void element
      .play()
      .then(() => {
        started.current = true;
        if (latest.current?.status.state !== "playing") element.pause();
      })
      .catch(() => undefined);
  }, [enabled, hasSong, state]);
  const seconds = Math.floor((view?.status.positionMs ?? 0) / 1000);
  const duration = (view?.status.durationMs ?? current?.durationMs ?? 0) / 1000;
  useEffect(() => {
    if (!enabled) return;
    if (duration > 0)
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(duration, Math.max(0, seconds)),
        playbackRate: 1,
      });
    else navigator.mediaSession.setPositionState();
  }, [enabled, seconds, duration]);
  return null;
}
