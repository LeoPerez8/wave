import { nativeImage } from "electron";

/** A small Wave glyph drawn at the tray's actual resolution, with no font dependency. */
export const trayIcon = () => {
  const side = 32;
  const pixels = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      if (Math.hypot(x - 15.5, y - 15.5) > 15) continue;
      const wave =
        x >= 6 && x <= 25 && Math.abs(y - (15.5 + 6 * Math.sin(((x - 6) * Math.PI) / 9.5))) < 1.6;
      const at = (y * side + x) * 4;
      pixels[at] = wave ? 255 : 184;
      pixels[at + 1] = wave ? 255 : 96;
      pixels[at + 2] = wave ? 255 : 36;
      pixels[at + 3] = 255;
    }
  return nativeImage.createFromBitmap(pixels, { width: side, height: side });
};
