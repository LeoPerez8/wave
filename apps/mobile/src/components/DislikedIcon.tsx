import Svg, { Path } from "react-native-svg";

type Props = { size?: number; color?: string; strokeWidth?: number };

/**
 * A disliked song's mark: Tabler's circle-minus filled, the minus cut out of
 * the disc (Tabler has the outline alone, which is Dislike's). On Tabler's
 * 24dp grid, the disc as its filled circles draw it.
 */
export function DislikedIcon({ size = 24, color = "currentColor" }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path
        fillRule="evenodd"
        d="M12 2a10 10 0 1 1 0 20a10 10 0 0 1 0-20zM9 11a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2z"
      />
    </Svg>
  );
}
