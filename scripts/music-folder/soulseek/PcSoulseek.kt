package wave.pc

import expo.modules.wavenative.soulseek.SoulseekCandidate
import expo.modules.wavenative.soulseek.SoulseekClient
import expo.modules.wavenative.soulseek.SoulseekCredentials
import expo.modules.wavenative.soulseek.SoulseekCredentialsStore
import expo.modules.wavenative.soulseek.SoulseekException
import expo.modules.wavenative.soulseek.SoulseekSwitchStore
import java.io.File
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread
import kotlin.system.exitProcess

/**
 * Wave's Android Soulseek client (SoulseekClient.kt, unchanged) on the PC, for
 * scripts/music-folder/replace.ts. The login comes from the environment
 * (SOULSEEK_USERNAME, SOULSEEK_PASSWORD) and stays in memory. Like the app, it
 * shares nothing and refuses uploads: that's the client's own behaviour.
 *
 * Commands on stdin, one per line, tab-separated, strings Base64 (UTF-8):
 *   search <id> <query>
 *   download <id> <username> <filename> <bytes> <expectedDurationMs> <part path>
 *   cancel <id>
 * Answers on stdout, one JSON object per line.
 */

private val out = Any()

private fun emit(json: String) = synchronized(out) { println(json); System.out.flush() }

private fun quote(text: String): String {
  val result = StringBuilder("\"")
  for (char in text) {
    when {
      char == '"' -> result.append("\\\"")
      char == '\\' -> result.append("\\\\")
      char < ' ' || char.code in 0x7f..0x9f || char.isSurrogate() -> result.append("\\u%04x".format(char.code))
      else -> result.append(char)
    }
  }
  return result.append('"').toString()
}

private fun decode(field: String) = String(Base64.getDecoder().decode(field), Charsets.UTF_8)

private fun candidateJson(c: SoulseekCandidate) =
  "{\"username\":${quote(c.username)},\"filename\":${quote(c.filename)},\"bytes\":${c.bytes}," +
    "\"bitrateKbps\":${c.bitrateKbps ?: "null"},\"durationMs\":${c.durationMs ?: "null"}," +
    "\"freeSlot\":${c.freeSlot},\"uploadSpeed\":${c.uploadSpeed},\"queueLength\":${c.queueLength}}"

private fun failureJson(id: String, e: Throwable): String {
  val failure = (e as? SoulseekException)?.failure?.code ?: "ERR_SLSK_PEER"
  return "{\"id\":${quote(id)},\"ok\":false,\"failure\":${quote(failure)},\"message\":${quote(e.message ?: e.toString())}}"
}

fun main() {
  val username = System.getenv("SOULSEEK_USERNAME").orEmpty()
  val password = System.getenv("SOULSEEK_PASSWORD").orEmpty()
  val host = System.getenv("WAVE_SOULSEEK_HOST") ?: "server.slsknet.org"
  val port = System.getenv("WAVE_SOULSEEK_PORT")?.toIntOrNull() ?: 2242
  val memory = object : SoulseekCredentialsStore {
    private var value: SoulseekCredentials? = null
    override fun load() = value
    override fun save(value: SoulseekCredentials?) { this.value = value }
  }
  val switch = object : SoulseekSwitchStore {
    private var on: Boolean? = null
    override fun load() = on
    override fun save(on: Boolean) { this.on = on }
  }
  val client = SoulseekClient(memory, host, port, switch = switch)
  try {
    client.connect(username, password)
    emit("{\"event\":\"connected\"}")
  } catch (e: Throwable) {
    emit(failureJson("connect", e))
    exitProcess(2)
  }
  val cancelled = ConcurrentHashMap.newKeySet<String>()
  while (true) {
    val line = readLine() ?: break
    val fields = line.split('\t')
    val id = fields.getOrNull(1) ?: continue
    when (fields[0]) {
      "search" -> thread(isDaemon = true) {
        try {
          val found = client.search(decode(fields[2]), 10_000)
          emit("{\"id\":${quote(id)},\"ok\":true,\"candidates\":[${found.joinToString(",") { candidateJson(it) }}]}")
        } catch (e: Throwable) { emit(failureJson(id, e)) }
      }
      "download" -> thread(isDaemon = true) {
        try {
          val candidate = SoulseekCandidate(decode(fields[2]), decode(fields[3]), fields[4].toLong(), 320, null, false, 0, 0)
          var reported = 0L
          val verified = client.download(
            id, candidate, File(decode(fields[6])), fields[5].toLong(),
            onProgress = { received, total ->
              val now = System.nanoTime()
              if (received == total || now - reported > 1_000_000_000L) {
                reported = now
                emit("{\"id\":${quote(id)},\"event\":\"progress\",\"received\":$received,\"total\":$total}")
              }
            },
            onQueued = { position -> emit("{\"id\":${quote(id)},\"event\":\"queued\",\"position\":$position}") },
            isCancelled = { cancelled.contains(id) },
          )
          emit("{\"id\":${quote(id)},\"ok\":true,\"durationMs\":${verified.durationMs},\"frames\":${verified.frames}}")
        } catch (e: Throwable) { emit(failureJson(id, e)) }
      }
      "cancel" -> { cancelled.add(id); client.cancel(id) }
    }
  }
  client.close()
  exitProcess(0)
}
