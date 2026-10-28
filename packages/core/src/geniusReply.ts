/** Reading Genius's API replies, shared by its song and referents requests. */

import { isRecord } from "./storedJson.ts";

/**
 * The `response` of a successful Genius reply (`meta.status` 200); null for
 * a failed or unreadable one.
 */
export const geniusResponse = (reply: unknown): Readonly<Record<string, unknown>> | null =>
  isRecord(reply) && isRecord(reply.meta) && reply.meta.status === 200 && isRecord(reply.response)
    ? reply.response
    : null;
