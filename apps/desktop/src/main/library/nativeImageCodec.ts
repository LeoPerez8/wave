/** A playlist image's photos through Electron's `nativeImage`, which main passes in. */
import type { NativeImage } from "electron";
import type { PlaylistImageCodec } from "./playlists.ts";

/** The longest a kept original's short side gets: enough to zoom in, far less than a camera's. */
const ORIGINAL_SIDE = 2400;

export const nativeImageCodec = (nativeImage: {
  readonly createFromBuffer: (buffer: Buffer) => NativeImage;
}): PlaylistImageCodec => ({
  original: (bytes) => {
    let image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) return undefined;
    const { width, height } = image.getSize();
    const short = Math.min(width, height);
    if (short > ORIGINAL_SIDE) {
      const scale = ORIGINAL_SIDE / short;
      image = image.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        quality: "best",
      });
    }
    const size = image.getSize();
    return { jpeg: image.toJPEG(90), width: size.width, height: size.height };
  },
  squares: (jpeg, square, sides) => {
    const cut = nativeImage.createFromBuffer(Buffer.from(jpeg)).crop({
      x: square.left,
      y: square.top,
      width: square.side,
      height: square.side,
    });
    return sides.map((side) => {
      const length = Math.min(side, square.side);
      return cut.resize({ width: length, height: length, quality: "best" }).toJPEG(90);
    });
  },
});
