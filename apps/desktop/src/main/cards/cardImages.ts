/**
 * Save Image and Copy Image for a rendered card (a Recap story, a lyrics card, a song card).
 * The window draws the card and hands main its PNG; main takes it only when it is a PNG no
 * larger than a card, and only main opens the save dialog and writes the file or the clipboard.
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { cardSize } from "../../shared/cards.ts";

/** What main does with a card's PNG, supplied by Electron (`index.ts`) or a test. */
export interface CardImagePorts {
  /** Opens the system's save dialog at [fileName] and writes [png]; false when it was cancelled. */
  readonly save: (fileName: string, png: Uint8Array) => Promise<boolean>;
  /** Puts [png] on the clipboard as an image. */
  readonly copy: (png: Uint8Array) => Promise<void>;
}

export class CardImages extends Context.Service<CardImages, CardImagePorts>()(
  "@wave/desktop/CardImages",
) {}

export const cardImagesLayer = (ports: CardImagePorts) => Layer.succeed(CardImages, ports);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A card's PNG is a few hundred kilobytes; this leaves room for a photographic cover. */
const MAX_PNG_BYTES = 24 * 1024 * 1024;

/** The PNG [value] carries in base64, when it is one a card can be; null for anything else. */
export const cardPng = (value: unknown): Uint8Array | null => {
  if (typeof value !== "string" || value.length === 0 || value.length > (MAX_PNG_BYTES * 4) / 3)
    return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  // The signature, then the IHDR chunk: its length, its name, the width and the height.
  if (bytes.length < 33 || PNG_SIGNATURE.some((byte, at) => bytes[at] !== byte)) return null;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return cardSize(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) ? bytes : null;
};

/** A card's file name as Core names it (`cardFileName`): one PNG's name, never a path. */
export const cardFileName = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length <= 160 &&
  // oxlint-disable-next-line no-control-regex -- control characters are what a file name can't hold
  /^Wave - [^<>:"/\\|?*\u0000-\u001f]+ - \d{8}-\d{6}\.png$/.test(value)
    ? value
    : null;

const refused = (call: string, why: string) => Effect.fail(new Error(`Refused ${call}: ${why}`));

export const cardImageHandlers = {
  "cards.saveImage": ([name, image]: readonly unknown[]) =>
    Effect.gen(function* () {
      const fileName = cardFileName(name);
      if (fileName === null) return yield* refused("cards.saveImage", "invalid file name");
      const png = cardPng(image);
      if (png === null) return yield* refused("cards.saveImage", "invalid image");
      const cards = yield* CardImages;
      return yield* Effect.tryPromise({
        try: () => cards.save(fileName, png),
        catch: (error) => error,
      });
    }),
  "cards.copyImage": ([image]: readonly unknown[]) =>
    Effect.gen(function* () {
      const png = cardPng(image);
      if (png === null) return yield* refused("cards.copyImage", "invalid image");
      const cards = yield* CardImages;
      yield* Effect.tryPromise({ try: () => cards.copy(png), catch: (error) => error });
    }),
};
