import Svg, { Path } from "react-native-svg";

type Props = { size?: number; color?: string; strokeWidth?: number };

/**
 * Shuffle braided: the two lanes cross twice, the top one passing over first
 * and the bottom one second, so they take turns. On Tabler's 24dp grid with
 * rounded strokes and Real Shuffle's arrowheads.
 */
export function EvenShuffleIcon({ size = 24, color = "currentColor", strokeWidth = 2 }: Props) {
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
      <Path d="M3 7h1C7 7 8 17 11 17c.9 0 1.62-.9 2.27-2.16M15.73 9.16C16.38 7.9 17.1 7 18 7h3M3 17h1c.9 0 1.62-.9 2.27-2.16M8.73 9.16C9.38 7.9 10.1 7 11 7c3 0 4 10 7 10h3" />
      <Path d="M18 4l3 3-3 3M18 20l3-3-3-3" />
    </Svg>
  );
}
