import Svg, { Path } from "react-native-svg";

type Props = { size?: number; color?: string; strokeWidth?: number };

/** A brain between the shuffle arrows, with Tabler's 24dp grid and rounded strokes. */
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
      <Path d="M2 5h2c2 0 2.5 1 3.5 2M16.5 17c1 1 1.5 2 3.5 2h2m-3-3 3 3-3 3" />
      <Path d="M2 19h2c2 0 2.5-1 3.5-2M16.5 7c1-1 1.5-2 3.5-2h2m-3-3 3 3-3 3" />
      <Path d="M12 7.5a2 2 0 0 0-3.8-.8 2.5 2.5 0 0 0-1 4.3 2.5 2.5 0 0 0 .8 4.6A2 2 0 0 0 12 17V7.5Z" />
      <Path d="M12 7.5a2 2 0 0 1 3.8-.8 2.5 2.5 0 0 1 1 4.3 2.5 2.5 0 0 1-.8 4.6A2 2 0 0 1 12 17M8 11h1m6 2h1" />
    </Svg>
  );
}
