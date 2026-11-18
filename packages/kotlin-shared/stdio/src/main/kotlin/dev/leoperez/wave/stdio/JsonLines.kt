package dev.leoperez.wave.stdio

import expo.modules.wavenative.soulseek.SoulseekException
import expo.modules.wavenative.yt.YtException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * The desktop's line to the JVM: one JSON object per line, requests going both ways.
 *
 *   host -> jvm  {"id":1,"method":"search","params":{"query":"..."}}
 *   jvm  -> host {"id":1,"result":...}   or   {"id":1,"error":{"code":"ERR_YT_OFFLINE","message":"..."}}
 *   jvm  -> host {"id":"j1","method":"poToken","params":{...}}   ([ask]; the host answers the same way)
 *   jvm  -> host {"event":"ready",...}                             ([event])
 *
 * An error's code is the one the phone's module rejects with ([codeOf]), so the desktop's JS reads
 * failures as the phone's does. Lines go out through [send], one call per line.
 */
class JsonLines(private val send: (String) -> Unit) {
  private val sending = Any()
  private val asked = ConcurrentHashMap<String, CompletableDeferred<JsonObject>>()
  private val ids = AtomicLong()

  /**
   * Answers each request [readLine] gives with [handle], each in its own coroutine, until
   * [readLine] gives null (the host closed stdin). Answers to [ask] go to whoever asked.
   */
  suspend fun serve(readLine: () -> String?, handle: suspend (method: String, params: JsonObject) -> JsonElement) =
    coroutineScope {
      while (true) {
        val text = withContext(Dispatchers.IO) { readLine() } ?: break
        if (text.isBlank()) continue
        val line = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
        val id = line?.get("id") as? JsonPrimitive
        if (line == null || id == null) {
          write(failed(JsonNull, "ERR_BAD_REQUEST", "Not a request: a JSON object with an id"))
          continue
        }
        val method = (line["method"] as? JsonPrimitive)?.contentOrNull
        if (method == null) {
          asked.remove(id.content)?.complete(line)
          continue
        }
        launch {
          val answer = try {
            buildJsonObject {
              put("id", id)
              put("result", handle(method, line["params"] as? JsonObject ?: JsonObject(emptyMap())))
            }
          } catch (e: CancellationException) {
            throw e
          } catch (e: Throwable) {
            failed(id, codeOf(e), e.message ?: e.javaClass.simpleName)
          }
          write(answer)
        }
      }
    }

  /**
   * Asks the host [method] and waits for its result: what only the host can do, like minting a
   * proof-of-origin token in its browser window. Fails with [HostError]: the host's, or
   * `ERR_HOST_TIMEOUT` without an answer in [timeoutMs].
   */
  suspend fun ask(method: String, params: JsonObject, timeoutMs: Long = 10_000): JsonElement {
    val id = "j${ids.incrementAndGet()}"
    val answer = CompletableDeferred<JsonObject>()
    asked[id] = answer
    try {
      write(buildJsonObject { put("id", id); put("method", method); put("params", params) })
      val line = withTimeoutOrNull(timeoutMs) { answer.await() }
        ?: throw HostError("ERR_HOST_TIMEOUT", "The host didn't answer $method")
      (line["error"] as? JsonObject)?.let { error ->
        throw HostError(
          (error["code"] as? JsonPrimitive)?.contentOrNull ?: "ERR_HOST",
          (error["message"] as? JsonPrimitive)?.contentOrNull ?: "The host failed $method",
        )
      }
      return line["result"] ?: JsonNull
    } finally {
      asked.remove(id)
    }
  }

  /** Tells the host something happened, unasked: `{"event":name,...fields}`. */
  fun event(name: String, fields: JsonObject = JsonObject(emptyMap())) =
    write(JsonObject(mapOf("event" to JsonPrimitive(name)) + fields))

  private fun write(line: JsonObject) = synchronized(sending) { send(json.encodeToString(JsonObject.serializer(), line)) }

  private fun failed(id: JsonElement, code: String, message: String) = buildJsonObject {
    put("id", id)
    put("error", buildJsonObject { put("code", code); put("message", message) })
  }

  companion object {
    private val json = Json { explicitNulls = true }

    /** The code the phone's module rejects [error] with, so JS reads it the same on both. */
    fun codeOf(error: Throwable): String = when (error) {
      is YtException -> error.failure.code
      is SoulseekException -> error.failure.code
      is CodedError -> error.code
      else -> "ERR_UNEXPECTED"
    }
  }
}

/** A failure with the code JS reads, from the JVM's own checks (an unknown method, bad params). */
open class CodedError(val code: String, message: String) : Exception(message)

/** The host's answer to [JsonLines.ask] was an error, or never came. */
class HostError(code: String, message: String) : CodedError(code, message)
