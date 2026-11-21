/** The playing song's cover colours, for Now Playing's tint and the lyrics card. */
import { pixelPalette, type ArtworkPalette } from "@wave/core";
import { useEffect, useState } from "react";

import type { BrowseRow } from "../../shared/browse.ts";

/** The artwork is sampled this small: plenty for a palette. */
const SAMPLE = 48;

/** The palette of the image at [src] (a data URL), or null when it can't be read. */
export const paletteOf = (src: string) =>
  new Promise<ArtworkPalette | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SAMPLE;
      canvas.height = SAMPLE;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) return resolve(null);
      context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
      resolve(pixelPalette(context.getImageData(0, 0, SAMPLE, SAMPLE).data));
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });

/** The current song's artwork palette, or null without artwork. */
export function usePalette(song: BrowseRow | null) {
  const hash = song?.artworkHash ?? null;
  const url = song?.artworkUrl ?? null;
  const id = song?.id;
  const key = hash ?? url ?? (id ? `song:${id}` : null);
  const [palette, setPalette] = useState<{ key: string; palette: ArtworkPalette | null }>();
  useEffect(() => {
    if (key === null) return;
    let current = true;
    void (
      hash !== null
        ? window.wave.library.artwork(hash, false)
        : url !== null
          ? window.wave.yt.artwork(url)
          : window.wave.library.cover("song", id!, false)
    )
      .then((image) => (image === null ? null : paletteOf(image)))
      .catch(() => null)
      .then((found) => {
        if (current) setPalette({ key, palette: found });
      });
    return () => {
      current = false;
    };
  }, [key, hash, url, id]);
  return key !== null && palette?.key === key ? palette.palette : null;
}
