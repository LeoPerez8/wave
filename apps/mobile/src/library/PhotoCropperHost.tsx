/**
 * Opening a playlist image's crop screen (`framePhoto`) and its host at the
 * root. The screen itself (`PhotoCropper`) loads the first time it opens.
 */
import type { ImageFraming } from "@wave/core";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import type { PlaylistPhoto } from "@/native/waveNative";

import { CropScreen } from "./PhotoCropper";
import type { FramePhoto } from "./playlists";

export interface CropRequest {
  readonly photo: PlaylistPhoto;
  readonly framing: ImageFraming;
  readonly done: (framing: ImageFraming | null) => void;
}

/** The photo being framed, while the crop screen is up (`PhotoCropperHost` draws it). */
const request = makeExternalStore<CropRequest | null>(null);

/** Opens the crop screen on [photo] at [framing]; resolves the framing on Done, null on Cancel. */
export const framePhoto: FramePhoto = (photo, framing) =>
  new Promise((resolve) => {
    // A crop screen already up (a second tap) gives way to the new one.
    request.get()?.done(null);
    request.set({
      photo,
      framing,
      done: (chosen) => {
        request.set(null);
        resolve(chosen);
      },
    });
  });

/** Draws the crop screen while it's up; mounted once at the root. */
export function PhotoCropperHost() {
  const current = useSyncExternalStore(request.subscribe, request.get);
  return current === null ? null : <CropScreen key={current.photo.path} request={current} />;
}
