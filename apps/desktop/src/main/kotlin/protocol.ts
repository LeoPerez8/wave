/**
 * The calls between main and the JVM (`packages/kotlin-shared/stdio`), one JSON object per line:
 *
 *   main -> jvm  {"id":1,"method":"readTags","params":{"path":"..."}}
 *   jvm  -> main {"id":1,"result":...}  or  {"id":1,"error":{"code":"ERR_...","message":"..."}}
 *   jvm  -> main {"id":"j1","method":"poToken","params":{...}}  (main answers the same way)
 *   jvm  -> main {"event":"ready","java":"21..."}
 *
 * Error codes are the phone's (`ERR_YT_*`, `ERR_SLSK_*`, `ERR_UNEXPECTED`) plus the JVM's own
 * (`ERR_BAD_REQUEST`, `ERR_UNKNOWN_METHOD`, `ERR_BAD_PARAMS`, `ERR_HOST`, `ERR_HOST_TIMEOUT`).
 */
import type { SongTags } from "../../shared/tags.ts";

/** What main can ask the JVM, as `WaveDesktop.handle` answers it. */
export interface KotlinMethods {
  /** An audio file's tags. */
  readonly readTags: { readonly params: { readonly path: string }; readonly result: SongTags };
  /** YouTube Music's Songs search, its first page (`YtSearchPage.toMap`). */
  readonly search: { readonly params: { readonly query: string }; readonly result: unknown };
}

export type KotlinMethod = keyof KotlinMethods;

/**
 * What the JVM can ask main, by method: each gets the request's params and answers its result,
 * or throws (an `Error` with a string `code` keeps it).
 */
export type HostMethods = Readonly<Record<string, (params: unknown) => Promise<unknown>>>;

/** Something the JVM tells main unasked, such as `ready`. */
export interface KotlinEvent {
  readonly event: string;
  readonly [field: string]: unknown;
}
