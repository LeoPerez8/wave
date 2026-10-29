// Renders Wave's default launcher icons and splash logos: two rounded white waves (#793).
// Zero dependencies: each pixel's coverage comes from its distance to the wave polylines,
// so the round caps and anti-aliasing are exact. Run with `pnpm --filter @wave/mobile icons`.
// The icons for other primaries and secondaries are vector drawables written at prebuild
// (plugins/launcherIcons.ts).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import {
  DEFAULT_THEME_CHOICE,
  LAUNCHER_ICON_RADIUS,
  LAUNCHER_ICONS,
  LOGO_WAVES,
  launchTheme,
  logoWaveY,
  type LogoWave,
} from "@wave/core";

type Rgb = readonly [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [0xff, 0xff, 0xff];

/** `#rrggbb` as channels. */
function rgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

// The shipped icon: the default primary and secondary (Core's first launcher icon).
const SHIPPED_ICON = LAUNCHER_ICONS[0]!;
const TOP = rgb(SHIPPED_ICON.top);
const BOTTOM = rgb(SHIPPED_ICON.bottom);

// White waves would vanish on the light splash background (#E0ECEF), so the light splash
// draws them as the shipped light launch theme does: in the text colour.
const SHIPPED_LIGHT = launchTheme(DEFAULT_THEME_CHOICE).light;
const LIGHT_TOP = rgb(SHIPPED_LIGHT.primary);
const LIGHT_BOTTOM = rgb(SHIPPED_LIGHT.secondary);

// The logo's shape is Core's (`LOGO_WAVES`), which the notification icon also draws.
const STROKE = LOGO_WAVES.stroke;

type Point = readonly [number, number];

/** One of the logo's waves as a fine polyline, x = -1..1. */
function wave(which: LogoWave): Point[] {
  const points: Point[] = [];
  const steps = 240;
  for (let i = 0; i <= steps; i++) {
    const x = -1 + (2 * i) / steps;
    points.push([x, logoWaveY(which, x)]);
  }
  return points;
}

const WAVES = { top: wave("top"), bottom: wave("bottom") };

/** Furthest any stroke edge reaches from the logo's centre. */
function radialExtent(): number {
  let max = 0;
  for (const [x, y] of [...WAVES.top, ...WAVES.bottom]) max = Math.max(max, Math.hypot(x, y));
  return max + STROKE / 2;
}

function distanceToPolyline(px: number, py: number, points: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

type Icon = {
  file: string;
  size: number;
  /** Fraction of the image width the logo's furthest edge may reach from the centre. */
  radius: number;
  background: Rgb | null;
  top: Rgb;
  bottom: Rgb;
};

function render({ size, radius, background, top, bottom }: Icon): Buffer {
  const scale = (radius * size) / radialExtent();
  const half = STROKE / 2;
  const channels = background ? 3 : 4;
  const stride = size * channels + 1;
  const raw = Buffer.alloc(stride * size);
  for (let row = 0; row < size; row++) {
    raw[row * stride] = 0; // PNG filter: none
    for (let col = 0; col < size; col++) {
      const x = (col + 0.5 - size / 2) / scale;
      const y = (row + 0.5 - size / 2) / scale;
      // Coverage of a pixel by a stroke edge, one pixel wide for anti-aliasing.
      const cover = (points: Point[]) =>
        Math.abs(y) > 0.6 || Math.abs(x) > 1.2
          ? 0
          : Math.max(0, Math.min(1, (half - distanceToPolyline(x, y, points)) * scale + 0.5));
      let rgb: [number, number, number] = background ? [...background] : [...top];
      let alpha = background ? 1 : 0;
      for (const [points, colour] of [
        [WAVES.top, top],
        [WAVES.bottom, bottom],
      ] as const) {
        const c = cover(points);
        if (c === 0) continue;
        const outAlpha = c + alpha * (1 - c);
        rgb = rgb.map((v, k) => (colour[k]! * c + v * alpha * (1 - c)) / outAlpha) as typeof rgb;
        alpha = outAlpha;
      }
      const o = row * stride + 1 + col * channels;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(rgb[k]!);
      if (!background) raw[o + 3] = Math.round(alpha * 255);
    }
  }
  return png(size, channels === 3 ? 2 : 6, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size: number, colourType: number, raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Adaptive icons: the launcher shows the middle 72dp of the 108dp layer and every mask keeps
// at least the 66dp circle (radius 0.305 of the width), so the waves stay inside
// LAUNCHER_ICON_RADIUS (0.27), as the vector icons do.
// Splash logos: expo-splash-screen draws the image 160dp wide under a 192dp circle mask
// (radius 0.6 of the width), so 0.5 leaves a margin.
const ICONS: Icon[] = [
  { file: "icon.png", size: 1024, radius: 0.36, background: BLACK, top: TOP, bottom: BOTTOM },
  {
    file: "adaptive-icon-foreground.png",
    size: 1024,
    radius: LAUNCHER_ICON_RADIUS,
    background: null,
    top: TOP,
    bottom: BOTTOM,
  },
  {
    file: "adaptive-icon-monochrome.png",
    size: 1024,
    radius: LAUNCHER_ICON_RADIUS,
    background: null,
    top: WHITE,
    bottom: WHITE,
  },
  { file: "splash-icon.png", size: 512, radius: 0.5, background: null, top: TOP, bottom: BOTTOM },
  {
    file: "splash-icon-light.png",
    size: 512,
    radius: 0.5,
    background: null,
    top: LIGHT_TOP,
    bottom: LIGHT_BOTTOM,
  },
];

const assets = new URL("../assets/", import.meta.url);
for (const icon of ICONS) {
  writeFileSync(new URL(icon.file, assets), render(icon));
  console.log(`wrote assets/${icon.file}`);
}
