/**
 * [text]'s SHA-256, in hex, through the Web Crypto global that Workers and Node both have. The
 * Workers key addresses and session tokens with it, so they keep the hash and never the value.
 */
export const sha256Hex = async (text: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};
