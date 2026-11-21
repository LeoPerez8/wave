package dev.leoperez.wave.stdio

import expo.modules.wavenative.log.WaveLog
import expo.modules.wavenative.recognize.UrlConnectionShazamHttp
import java.io.File
import java.io.FileDescriptor
import java.io.FileOutputStream
import java.io.PrintStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The desktop's JVM: `java -jar wave-kotlin.jar --data <dir> [--shazam-url <origin>]` speaks [JsonLines] over stdin and
 * stdout until the host closes stdin. Only protocol lines go to stdout; app log entries and
 * anything else printed go to stderr. It sends a `ready` event once it can take requests.
 */
fun main(args: Array<String>) {
  val dataDir = File(args.valueOf("--data") ?: System.getProperty("user.dir"))
  val out = PrintStream(FileOutputStream(FileDescriptor.out), false, "UTF-8")
  System.setOut(System.err)
  WaveLog.echo = { level, tag, message, error ->
    System.err.println("$level $tag $message" + (error?.let { " (${it.javaClass.simpleName})" } ?: ""))
  }
  val lines = JsonLines { line ->
    synchronized(out) {
      out.println(line)
      out.flush()
    }
  }
  val desktop = args.valueOf("--shazam-url")
    ?.let { WaveDesktop(lines, dataDir, shazam = shazamAt(it, UrlConnectionShazamHttp())) }
    ?: WaveDesktop(lines, dataDir)
  val input = System.`in`.bufferedReader(Charsets.UTF_8)
  lines.event("ready", buildJsonObject { put("java", JsonPrimitive(System.getProperty("java.version"))) })
  runBlocking(Dispatchers.Default) { lines.serve(input::readLine, desktop::handle) }
  desktop.close()
  desktop.yt.http.close()
}

private fun Array<String>.valueOf(flag: String): String? =
  indexOf(flag).takeIf { it >= 0 }?.let { getOrNull(it + 1) }
