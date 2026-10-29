/**
 * The app log's lines about playlist imports. Log text stays English in every
 * language, so these sit apart from the catalogue's interface text.
 */

/** A link import done: [what] it gave the playlist, at once or once Wave started ([resumed]). */
export const importDoneLogLine = (
  name: string,
  service: string,
  what: string,
  resumed: boolean,
): string =>
  resumed
    ? `Import of "${name}" from ${service}, kept from before the update, ended as Wave started: ${what}`
    : `Import of "${name}" from ${service} done at once: ${what}`;

/** A From YT Music or From Spotify read that failed for [reason]. */
export const importReadFailedLogLine = (name: string, service: string, reason: string): string =>
  `Import of "${name}" from ${service} couldn't read the playlist (${reason}); it stays empty, with Try Again`;

/** A batch paused at a read for [reason]. */
export const importPausedLogLine = (name: string, service: string, reason: string): string =>
  `Import of "${name}" from ${service} waits (${reason}); the batch goes on when Wave starts again, comes back to the foreground or imports again`;
