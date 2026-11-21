/**
 * The play still adding its songs to the queue, by its queue context (New from Artists You
 * Follow's Play while it reads its releases); null when none is. The queue doesn't continue into
 * a Magic Queue while it is still that play's (Core's `queueContinuation`, `filling`).
 */
import type { QueueContext } from "@wave/core";
import { makeExternalStore } from "@wave/client/externalStore";

export const fillingPlay = makeExternalStore<QueueContext | null>(null);
