/**
 * A song's Share submenu (docs/spec.md, Sharing a song): Copy Link, Copy Spotify Link and Copy
 * YT Music Link as main found them (`window.wave.links.songShare`), then Save Image and Copy
 * Image, which draw the song's card (the phone's, 1080 px wide) into a PNG.
 */
import { logoIconPaths, songCardColours, songCardFileName, withOpacity } from "@wave/core";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { SongShareCover, SongShareView } from "../../shared/links.ts";
import type { SongTarget } from "../../shared/songActions.ts";
import { cardPng } from "./cardImage.ts";
import { Icon } from "./Icon.tsx";
import { copyLink } from "./copyLink.ts";
import type { MenuItem } from "./Menu.tsx";
import { paletteOf } from "./useSongPalette.ts";
import { text } from "./text.ts";
import { largestCover } from "./VirtualTable.tsx";

/** The card's width in pixels, its image's; its height is [SONG_CARD_ASPECT] times it. */
export const SONG_CARD_WIDTH = 1080;
/** The phone's card: the square cover, the title, artist and mark under it. */
const SONG_CARD_ASPECT = 1.4;

/** Wave's logo, its two waves stroked in [colour], in a [size] square. */
function WaveMark({ size, colour }: { readonly size: number; readonly colour: string }) {
  const paths = logoIconPaths({ size, inset: 0 });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {[paths.top, paths.bottom].map((d) => (
        <path
          key={d}
          d={d}
          stroke={colour}
          strokeWidth={paths.stroke}
          strokeLinecap="round"
          fill="none"
        />
      ))}
    </svg>
  );
}

/** What a song's card shows: its title and artist, and its cover as a `data:` address. */
export interface SongCardContent {
  readonly title: string;
  readonly artist: string;
  readonly cover: string | null;
}

/**
 * A song's card as the phone draws it: the cover large, the title and artist under it and a
 * discreet Wave mark, on the colour Core takes from the cover ([colours]).
 */
export function SongCard({
  content,
  colours,
}: {
  readonly content: SongCardContent;
  readonly colours: ReturnType<typeof songCardColours>;
}) {
  const width = SONG_CARD_WIDTH;
  const unit = width / 100;
  const { card, ink } = colours;
  const faded = withOpacity(ink, 0.72);
  const cover = width - unit * 14;
  return (
    <div
      className="song-card"
      data-testid="song-card"
      style={{
        width,
        height: width * SONG_CARD_ASPECT,
        padding: unit * 7,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        backgroundColor: card,
        color: ink,
        overflow: "hidden",
        fontFamily: "inherit",
      }}
    >
      {content.cover === null ? (
        <div
          style={{
            width: cover,
            height: cover,
            flexShrink: 0,
            borderRadius: unit * 2.5,
            backgroundColor: withOpacity(ink, 0.16),
            color: faded,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="songs" size={cover / 3} />
        </div>
      ) : (
        <img
          src={content.cover}
          alt=""
          style={{
            width: cover,
            height: cover,
            flexShrink: 0,
            borderRadius: unit * 2.5,
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
      <p
        style={{
          margin: `${unit * 5}px 0 0`,
          fontSize: unit * 6.4,
          lineHeight: `${unit * 7.8}px`,
          letterSpacing: -unit * 0.06,
          fontWeight: 700,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {content.title}
      </p>
      <p
        style={{
          margin: 0,
          color: faded,
          fontSize: unit * 5,
          lineHeight: `${unit * 6.6}px`,
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {content.artist}
      </p>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: unit * 1.5, color: faded }}>
        <WaveMark size={unit * 6} colour={faded} />
        <span style={{ fontSize: unit * 3.6, fontWeight: 600 }}>Wave</span>
      </div>
    </div>
  );
}

/** The cover of the song [cover] names, at its largest, as a `data:` address. */
const coverImage = (cover: SongShareCover | null): Promise<string | null> =>
  cover === null
    ? Promise.resolve(null)
    : (cover.kind === "song"
        ? window.wave.library.cover("song", cover.id, true)
        : largestCover(cover.url)
      ).catch(() => null);

/** [view]'s card drawn into a PNG, in base64: laid out out of sight, drawn, and taken away. */
export const songCardPng = async (view: SongShareView): Promise<string> => {
  const cover = await coverImage(view.cover);
  const palette = cover === null ? null : await paletteOf(cover);
  const host = document.createElement("div");
  // Out of the window's sight, but laid out: the image is drawn from its computed styles.
  host.style.cssText = "position: fixed; left: -20000px; top: 0; pointer-events: none;";
  host.setAttribute("aria-hidden", "true");
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <SongCard
          content={{ title: view.title, artist: view.artist, cover }}
          colours={songCardColours(palette)}
        />,
      ),
    );
    const card = host.firstElementChild;
    if (!(card instanceof HTMLElement)) throw new Error("The card didn't render");
    return await cardPng(card);
  } finally {
    root.unmount();
    host.remove();
  }
};

/** Save Image or Copy Image for [view]'s card, with their toasts. */
const shareImage = async (
  view: SongShareView,
  kind: "saveImage" | "copyImage",
  notify: (message: string) => void,
): Promise<void> => {
  try {
    const png = await songCardPng(view);
    if (kind === "copyImage") {
      await window.wave.cards.copyImage(png);
      notify(text.share.imageCopied);
    } else if (await window.wave.cards.saveImage(songCardFileName(view.title, new Date()), png)) {
      notify(text.share.imageSaved);
    }
  } catch {
    notify(kind === "copyImage" ? text.share.copyImageFailed : text.share.saveImageFailed);
  }
};

/**
 * The Share submenu of a Library song ([song], a one-song target) or a streamed one (its video
 * id): a link main couldn't find is disabled and says why under its label.
 */
export const songShareItems = async (
  song: SongTarget | string,
  notify: (message: string) => void,
): Promise<readonly MenuItem[]> => {
  const view = await window.wave.links.songShare(song);
  return view.items.map((item): MenuItem => {
    if (item.kind !== "link")
      return {
        key: item.kind,
        label: item.label,
        run: () => void shareImage(view, item.kind, notify),
      };
    const { url } = item;
    return {
      key: `share-${item.option}`,
      label: item.label,
      ...(item.note === null ? {} : { line: item.note }),
      ...(url === null
        ? { disabled: true }
        : { run: () => void copyLink(window.wave.links.copyShareLink(url)) }),
    };
  });
};
