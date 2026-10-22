export type LostTapReason =
  | "link not ready"
  | `close taken over by ${"Back" | "chevron" | "card"}`
  | "target gone"
  | "unknown";

export interface LostLinkTap {
  readonly kind: "artistLink" | "albumLink";
  readonly from: string;
  readonly to: string;
  readonly reason: LostTapReason;
}

export const lostTapLine = (tap: LostLinkTap): string =>
  `Lost ${tap.kind === "artistLink" ? "artist" : "album"} link to ${tap.to} from ${tap.from}: no navigation after 1 s; ${tap.reason}`;
