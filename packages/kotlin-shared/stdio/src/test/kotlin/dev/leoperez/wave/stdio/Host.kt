package dev.leoperez.wave.stdio

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * The host's end of [JsonLines] in memory: what Electron's main process does over the JVM's
 * stdin and stdout. [write] sends a line to the JVM; [next] takes the JVM's next line.
 */
class Host {
  private val toJvm = LinkedBlockingQueue<String>()
  private val fromJvm = LinkedBlockingQueue<String>()
  val lines = JsonLines { fromJvm.put(it) }

  /** Serves [handle] until [close], on its own threads as the JVM entry point does. */
  fun serve(scope: CoroutineScope, handle: suspend (String, JsonObject) -> kotlinx.serialization.json.JsonElement): Job =
    scope.launch(Dispatchers.Default) { lines.serve({ toJvm.take().takeUnless { it == END } }, handle) }

  fun write(line: String) = toJvm.put(line)

  fun next(): JsonObject {
    val line = fromJvm.poll(20, TimeUnit.SECONDS) ?: error("The JVM sent nothing")
    return Json.parseToJsonElement(line).jsonObject
  }

  /** Ends the JVM's input, as the host closing stdin does. */
  fun close() = toJvm.put(END)

  private companion object {
    const val END = "\u0000end"
  }
}

/**
 * Runs [block] against a [Host] serving [handle], ending the JVM's input afterwards even when
 * [block] fails, so a failed check ends the test instead of leaving it waiting.
 */
fun withHost(
  handle: suspend (String, JsonObject) -> kotlinx.serialization.json.JsonElement,
  host: Host = Host(),
  block: suspend CoroutineScope.(Host) -> Unit,
) = kotlinx.coroutines.runBlocking {
  val serving = host.serve(this, handle)
  try {
    kotlinx.coroutines.withTimeout(30_000) { block(host) }
  } finally {
    host.close()
    serving.cancel()
  }
}
