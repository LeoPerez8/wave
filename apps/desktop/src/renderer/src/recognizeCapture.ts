/**
 * Recognize's capture in the window: what main names (`RecognizeCapture`), as 16 kHz mono
 * 16-bit PCM in pieces of about a quarter second. Main's permission handlers decide whether the
 * browser hands the window the microphone or the computer's sound at all.
 */
import { pcm16, type RecognizeCaptureVia } from "../../shared/recognize.ts";

const SAMPLE_RATE = 16_000;
/** About a quarter second at 16 kHz. */
const PIECE = 4096;

/** The browser's processing would change what Shazam hears. */
const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

/** Why a capture couldn't start: the system refused it, or anything else. */
export class CaptureError extends Error {
  readonly why: "denied" | "failed";
  constructor(why: "denied" | "failed") {
    super(why === "denied" ? "Capture refused" : "Capture failed");
    this.why = why;
  }
}

const stream = async (via: RecognizeCaptureVia): Promise<MediaStream> => {
  const media = navigator.mediaDevices;
  switch (via) {
    case "microphone":
      return media.getUserMedia({ audio: { ...RAW_AUDIO, channelCount: 1 } });
    case "monitor": {
      // PulseAudio and PipeWire list what Linux plays as an input named "Monitor of …".
      const monitor = (await media.enumerateDevices()).find(
        (device) => device.kind === "audioinput" && /^monitor of /i.test(device.label),
      );
      if (monitor === undefined) throw new CaptureError("failed");
      return media.getUserMedia({ audio: { ...RAW_AUDIO, deviceId: { exact: monitor.deviceId } } });
    }
    case "loopback": {
      const display = await media.getDisplayMedia({ video: true, audio: true });
      // Only the sound is kept: the picture main had to name is never looked at.
      for (const track of display.getVideoTracks()) {
        track.stop();
        display.removeTrack(track);
      }
      if (display.getAudioTracks().length === 0) throw new CaptureError("failed");
      return display;
    }
  }
};

/**
 * Starts capturing [via], sending each piece to [heard]; [ended] hears a capture that stopped on
 * its own. Resolves with the stop, or rejects with a `CaptureError`.
 */
export const startCapture = async (
  via: RecognizeCaptureVia,
  heard: (pcm: Uint8Array) => void,
  ended: () => void,
): Promise<() => void> => {
  let media: MediaStream;
  try {
    media = await stream(via);
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(
      error instanceof DOMException && error.name === "NotAllowedError" && via !== "loopback"
        ? "denied"
        : "failed",
    );
  }
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = context.createMediaStreamSource(media);
  // A ScriptProcessor needs no module file, which the window's page rules wouldn't load.
  const processor = context.createScriptProcessor(PIECE, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  let stopped = false;
  processor.onaudioprocess = (event) => {
    if (!stopped) heard(pcm16(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    processor.onaudioprocess = null;
    for (const track of media.getTracks()) track.stop();
    void context.close().catch(() => undefined);
  };
  for (const track of media.getAudioTracks())
    track.addEventListener("ended", () => {
      if (stopped) return;
      stop();
      ended();
    });
  return stop;
};
