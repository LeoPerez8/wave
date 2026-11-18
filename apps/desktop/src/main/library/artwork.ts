import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import type { LibraryDatabase } from "@wave/client/db/database";
import { artwork } from "@wave/client/db/schema";

/** Hash original embedded bytes as on Android; resize only the display files. */
export const artworkStore = (
  db: LibraryDatabase,
  directory: string,
  process: (bytes: Buffer) => { readonly thumb: Buffer; readonly medium: Buffer } | undefined,
) => {
  const saved = new Set<string>();
  return async (encoded: string): Promise<string | null> => {
    if (encoded.length > 12 * 1024 * 1024) return null;
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 8 * 1024 * 1024) return null;
    const hash = createHash("sha1").update(bytes).digest("hex");
    if (saved.has(hash)) return hash;
    try {
      const display = process(bytes);
      if (!display) return null;
      await mkdir(directory, { recursive: true });
      const extension = bytes[0] === 0x89 ? "png" : bytes[0] === 0xff ? "jpg" : "img";
      const path = join(directory, `${hash}.${extension}`);
      const thumbPath = join(directory, `${hash}_thumb.jpg`);
      const atomic = async (file: string, content: Buffer) => {
        await writeFile(`${file}.tmp`, content);
        await rename(`${file}.tmp`, file);
      };
      await Promise.all([
        atomic(path, bytes),
        atomic(thumbPath, display.thumb),
        atomic(join(directory, `${hash}_medium.jpg`), display.medium),
      ]);
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
    const bytes = large
      ? await readFile(join(dirname(row.path), `${hash}_medium.jpg`)).catch(() =>
          readFile(row.path),
        )
      : await readFile(row.thumbPath);
    const mime = bytes[0] === 0xff ? "image/jpeg" : "image/png";
    return bytes.length <= 2 * 1024 * 1024
      ? `data:${mime};base64,${bytes.toString("base64")}`
      : null;
  } catch {
    return null;
  }
};
