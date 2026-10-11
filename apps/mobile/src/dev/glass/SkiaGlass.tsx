import {
  Blur,
  Canvas,
  Group,
  Image,
  LinearGradient,
  Paint,
  RoundedRect,
  RuntimeShader,
  Skia,
  rect,
  rrect,
  vec,
  type SkImage,
} from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

/** Same lens + rim maths as the native AGSL shader, in SkSL. */
const refractionEffect = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform float2 size;
uniform float radius;
uniform float refraction;
uniform float edge;

float roundRect(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

half4 main(float2 coord) {
  float2 halfSize = size * 0.5;
  float2 p = coord - halfSize;
  float d = roundRect(p, halfSize, radius);
  float t = clamp(1.0 + d / edge, 0.0, 1.0);
  float2 e = float2(1.0, 0.0);
  float2 n = float2(
    roundRect(p + e.xy, halfSize, radius) - roundRect(p - e.xy, halfSize, radius),
    roundRect(p + e.yx, halfSize, radius) - roundRect(p - e.yx, halfSize, radius));
  n = n / max(length(n), 0.0001);
  half4 color = image.eval(coord - n * (t * t * t * refraction));
  float light = clamp(dot(n, normalize(float2(-0.5, -1.0))), 0.0, 1.0);
  color.rgb += half3(pow(t, 8.0) * light * 0.35);
  return color;
}
`);

export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

type Props = {
  /** Snapshot of the scroll content, taken with `makeImageFromView`. */
  snapshot: SkImage | null;
  /** Size of the scroll content in dp (what the snapshot covers). */
  contentSize: { width: number; height: number };
  scrollY: SharedValue<number>;
  /** Screen y of the top of the content when scrolled to the top. */
  contentTop: number;
  /** Where the glass sits on screen. */
  frame: Frame;
  blurRadius: number;
  refraction: number;
  cornerRadius: number;
  tint: string;
};

/**
 * Spike (#4), technique B: Skia can't sample native views, so the scroll
 * content is snapshotted once and drawn behind the glass, offset by the scroll
 * position on the UI thread. Blur, refraction and rim all happen in Skia.
 * The cost is that the snapshot goes stale whenever the content changes.
 */
export function SkiaGlass({
  snapshot,
  contentSize,
  scrollY,
  contentTop,
  frame,
  blurRadius,
  refraction,
  cornerRadius,
  tint,
}: Props) {
  const imageY = useDerivedValue(() => contentTop - scrollY.value - frame.y);
  const radius = Math.min(cornerRadius, frame.height / 2);
  const shape = rrect(rect(0, 0, frame.width, frame.height), radius, radius);

  return (
    <Canvas
      pointerEvents="none"
      style={{
        position: "absolute",
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
      }}
    >
      <Group
        clip={shape}
        layer={
          refraction > 0 && refractionEffect ? (
            <Paint>
              <RuntimeShader
                source={refractionEffect}
                uniforms={{
                  size: vec(frame.width, frame.height),
                  radius,
                  refraction,
                  edge: 16,
                }}
              />
            </Paint>
          ) : undefined
        }
      >
        {snapshot ? (
          <Image
            image={snapshot}
            x={-frame.x}
            y={imageY}
            width={contentSize.width}
            height={contentSize.height}
            fit="fill"
          >
            <Blur blur={blurRadius} mode="clamp" />
          </Image>
        ) : null}
        <RoundedRect rect={shape} color={tint} />
      </Group>
      <RoundedRect
        x={0.5}
        y={0.5}
        width={frame.width - 1}
        height={frame.height - 1}
        r={radius}
        style="stroke"
        strokeWidth={1}
      >
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, frame.height)}
          colors={["rgba(255,255,255,0.6)", "rgba(255,255,255,0.12)"]}
        />
      </RoundedRect>
    </Canvas>
  );
}
