import { logoIconPaths } from "@wave/core";
import Svg, { Path } from "react-native-svg";

type Props = {
  /** The logo's width, round caps included, in dp. */
  readonly size: number;
  /** The waves' colour; the top wave's when [bottom] is given. */
  readonly colour: string;
  /** The bottom wave's colour, when it differs from the top one's. */
  readonly bottom?: string;
  /** The drawing's height, the waves centred in it; a [size] square by default. */
  readonly height?: number;
};

/** Wave's logo: its two waves stroked in [colour], or in [colour] over [bottom]. */
export function WaveMark({ size, colour, bottom = colour, height = size }: Props) {
  const paths = logoIconPaths({ size, inset: 0 });
  return (
    <Svg width={size} height={height} viewBox={`0 ${(size - height) / 2} ${size} ${height}`}>
      <Path
        d={paths.top}
        stroke={colour}
        strokeWidth={paths.stroke}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d={paths.bottom}
        stroke={bottom}
        strokeWidth={paths.stroke}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
