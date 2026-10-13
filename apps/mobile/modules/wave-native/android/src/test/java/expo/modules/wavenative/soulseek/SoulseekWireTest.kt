package expo.modules.wavenative.soulseek

import java.io.ByteArrayInputStream
import java.io.EOFException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SoulseekWireTest {
  @Test fun `a peer message remains intact when TCP splits its payload across small reads`() {
    // Little-endian length 9, code 41 and five payload bytes, independent wire fixture.
    val packet = byteArrayOf(9, 0, 0, 0, 41, 0, 0, 0, 1, 2, 3, 4, 5)
    val fragmented = object : ByteArrayInputStream(packet) {
      override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
        super.read(buffer, offset, minOf(length, 2))
    }
    val response = SoulseekWire.read(fragmented)
    assertEquals(41, response.code)
    assertArrayEquals(byteArrayOf(1, 2, 3, 4, 5), response.payload)
  }

  @Test fun `a peer that disconnects during a declared message cannot provide a partial payload`() {
    val packet = byteArrayOf(9, 0, 0, 0, 41, 0, 0, 0, 1, 2)
    assertThrows(EOFException::class.java) { SoulseekWire.read(ByteArrayInputStream(packet)) }
  }

  @Test fun `a compressed peer response exceeding four MiB is rejected`() {
    val compressed = SoulseekWire.deflate(ByteArray(4 * 1024 * 1024 + 1) { 1 })
    val failure = assertThrows(SoulseekException::class.java) { SoulseekWire.inflate(compressed) }
    assertEquals(SoulseekFailure.PROTOCOL, failure.failure)
  }

  @Test fun `a compressed peer response exactly at four MiB is accepted`() {
    val plain = ByteArray(4 * 1024 * 1024) { 1 }
    assertArrayEquals(plain, SoulseekWire.inflate(SoulseekWire.deflate(plain)))
  }
}
