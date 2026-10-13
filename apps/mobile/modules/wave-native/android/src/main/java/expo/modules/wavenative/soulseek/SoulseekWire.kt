package expo.modules.wavenative.soulseek

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.DeflaterOutputStream
import java.util.zip.InflaterInputStream

/** Little-endian Soulseek TCP messages, with bounded allocations for untrusted peers. */
object SoulseekWire {
  data class Message(val code: Int, val payload: ByteArray)
  private const val MAX_PACKET = 4 * 1024 * 1024

  fun read(input: InputStream, byteCode: Boolean = false): Message {
    val length = Reader(input).uint()
    val codeBytes = if (byteCode) 1 else 4
    if (length < codeBytes || length > MAX_PACKET) throw SoulseekException(SoulseekFailure.PROTOCOL)
    val code = if (byteCode) Reader(input).byte() else Reader(input).uint().toInt()
    return Message(code, Reader(input).bytes((length - codeBytes).toInt()))
  }

  fun write(output: OutputStream, code: Int, byteCode: Boolean = false, body: Writer.() -> Unit = {}) {
    val writer = Writer().apply(body)
    val payload = writer.result()
    synchronized(output) {
      val header = Writer().apply {
        uint((payload.size + if (byteCode) 1 else 4).toLong())
        if (byteCode) byte(code) else uint(code.toLong())
      }.result()
      output.write(header)
      output.write(payload)
      output.flush()
    }
  }

  fun reader(bytes: ByteArray) = Reader(ByteArrayInputStream(bytes))
  fun inflate(bytes: ByteArray): ByteArray = InflaterInputStream(ByteArrayInputStream(bytes)).use {
    val plain = it.readNBytes(MAX_PACKET + 1)
    if (plain.size > MAX_PACKET) throw SoulseekException(SoulseekFailure.PROTOCOL)
    plain
  }
  fun deflate(bytes: ByteArray): ByteArray {
    val result = ByteArrayOutputStream()
    DeflaterOutputStream(result).use { it.write(bytes) }
    return result.toByteArray()
  }

  class Reader(private val input: InputStream) {
    fun byte(): Int = input.read().also { if (it < 0) throw EOFException("Soulseek connection closed") }
    fun uint(): Long = (0..3).fold(0L) { value, shift -> value or (byte().toLong() shl (shift * 8)) }
    fun ulong(): Long {
      val value = (0..7).fold(0L) { value, shift -> value or (byte().toLong() shl (shift * 8)) }
      if (value < 0) throw SoulseekException(SoulseekFailure.PROTOCOL)
      return value
    }
    fun bytes(size: Int): ByteArray {
      if (size < 0 || size > MAX_PACKET) throw SoulseekException(SoulseekFailure.PROTOCOL)
      return input.readNBytes(size).also { if (it.size != size) throw EOFException("Incomplete Soulseek message") }
    }
    fun string(): String {
      val size = uint()
      if (size > 16_384) throw SoulseekException(SoulseekFailure.PROTOCOL)
      val bytes = bytes(size.toInt())
      // Official clients also send legacy Windows-1252 strings.
      val utf8 = String(bytes, Charsets.UTF_8)
      return if ('\ufffd' in utf8) String(bytes, charset("windows-1252")) else utf8
    }
  }

  class Writer {
    private val output = ByteArrayOutputStream()
    fun byte(value: Int) { output.write(value) }
    fun uint(value: Long) { (0..3).forEach { byte((value ushr (it * 8)).toInt()) } }
    fun ulong(value: Long) { (0..7).forEach { byte((value ushr (it * 8)).toInt()) } }
    fun string(value: String) { val encoded = value.toByteArray(Charsets.UTF_8); uint(encoded.size.toLong()); bytes(encoded) }
    fun bytes(value: ByteArray) { output.write(value) }
    fun result(): ByteArray = output.toByteArray()
  }
}
