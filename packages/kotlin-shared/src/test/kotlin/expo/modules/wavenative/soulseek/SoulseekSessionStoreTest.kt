package expo.modules.wavenative.soulseek

import java.nio.file.Files
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.*
import org.junit.Test

class SoulseekSessionStoreTest {
  @Test fun `the best quality switch survives a restart and is unset on a phone from before it`() {
    val folder = Files.createTempDirectory("wave-switch").toFile()
    val file = folder.resolve("switch")
    try {
      assertNull(SoulseekSwitchFile(file).load())
      SoulseekSwitchFile(file).save(false)
      assertEquals(false, SoulseekSwitchFile(file).load())
      SoulseekSwitchFile(file).save(true)
      assertEquals(true, SoulseekSwitchFile(file).load())
    } finally { folder.deleteRecursively() }
  }

  @Test fun `a restarted account store restores only authenticated encrypted credentials and sign out removes them`() {
    val folder = Files.createTempDirectory("wave-session").toFile()
    val file = folder.resolve("session")
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val protector = object : SoulseekCredentialCipher {
      override fun encrypt(value: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        return cipher.iv + cipher.doFinal(value)
      }
      override fun decrypt(value: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, value.copyOfRange(0, 12)))
        return cipher.doFinal(value.copyOfRange(12, value.size))
      }
    }
    try {
      SoulseekSessionStore(file, protector).save(SoulseekCredentials("wave-fixture", "fixture-secret"))
      assertFalse(file.readText().contains("fixture-secret"))
      assertEquals("fixture-secret", SoulseekSessionStore(file, protector).load()!!.password)
      val bytes = file.readBytes()
      bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
      file.writeBytes(bytes)
      assertNull(SoulseekSessionStore(file, protector).load())
      SoulseekSessionStore(file, protector).save(null)
      assertFalse(file.exists())
    } finally { folder.deleteRecursively() }
  }
}
