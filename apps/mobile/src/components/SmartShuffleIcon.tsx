import Svg, { Path } from "react-native-svg";

type Props = { size?: number; color?: string; strokeWidth?: number };

/** Shuffle with a single spark, on Tabler's 24dp grid with rounded strokes. */
export function SmartShuffleIcon({ size = 24, color = "currentColor", strokeWidth = 2 }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 17h2c3.8 0 6.2-10 10-10M3 7h2c1.6 0 3 1.4 4.3 3.3M13.7 13.7C15 15.6 16.4 17 18 17h3m-3-3 3 3-3 3" />
      <Path d="m19 2 1.1 3.4L23 6.5l-2.9 1.1L19 11l-1.1-3.4L15 6.5l2.9-1.1L19 2Z" />
    </Svg>
  );
}
