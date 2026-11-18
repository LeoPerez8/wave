import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import { artwork } from "@wave/client/db/schema";

/** Hash original embedded bytes as on Android; resize only the display files. */
export const artworkStore = (
  db: LibraryDatabase,
  directory: string,
  resize: (bytes: Buffer, size: number) => Buffer,
) => {
  const saved = new Set<string>();
  return async (encoded: string): Promise<string | null> => {
    if (encoded.length > 12 * 1024 * 1024) return null;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 8 * 1024 * 1024) return null;
    const hash = createHash("sha1").update(bytes).digest("hex");
    if (saved.has(hash)) return hash;
    try {
      const image = resize(bytes, 512);
      const thumb = resize(bytes, 56);
      if (!image.length || !thumb.length) return null;
      await mkdir(directory, { recursive: true });
      const path = join(directory, `${hash}.png`);
      const thumbPath = join(directory, `${hash}.thumb.png`);
      await Promise.all([writeFile(path, image), writeFile(thumbPath, thumb)]);
      db.insert(artwork)
        .values({ hash, path, thumbPath, palette: {} })
        .onConflictDoUpdate({ target: artwork.hash, set: { path, thumbPath } })
        .run();
      saved.add(hash);
      return hash;
    } catch {
      return null;
    }
  };
};

/** Only database-indexed artwork is readable, never a renderer-supplied file path. */
export const readArtwork = async (
  db: LibraryDatabase,
  hash: string,
  large: boolean,
): Promise<string | null> => {
  const row = db.select().from(artwork).where(eq(artwork.hash, hash)).get();
  if (!row) return null;
  try {
    const bytes = await readFile(large ? row.path : row.thumbPath);
    return bytes.length <= 2 * 1024 * 1024
      ? `data:image/png;base64,${bytes.toString("base64")}`
      : null;
  } catch {
    return null;
  }
};
