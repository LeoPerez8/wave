package expo.modules.wavenative.account

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WaveAccountStoreTest {
  private val ana = WaveAccountInfo("ana@example.com", "Ana Lima", "https://lh3.googleusercontent.com/a/ana")
  private val signedIn = WaveSessionState.SignedIn("https://sync.example", "fixture-session-token", ana)

  @Test fun `a restarted store restores the session, and the file never holds the token in the clear`() {
    val folder = Files.createTempDirectory("wave-account").toFile()
    val file = folder.resolve("wave-account-session")
    try {
      WaveAccountStore(file, TestCipher()).save(signedIn)
      assertFalse(String(file.readBytes(), Charsets.ISO_8859_1).contains("fixture-session-token"))
      assertEquals(signedIn, WaveAccountStore(file, TestCipher.sameKey).load())
    } finally { folder.deleteRecursively() }
  }

  @Test fun `an ended session is kept with its account and no token`() {
    val folder = Files.createTempDirectory("wave-account").toFile()
    val file = folder.resolve("wave-account-session")
    try {
      WaveAccountStore(file, TestCipher()).save(WaveSessionState.Ended(ana))
      assertEquals(WaveSessionState.Ended(ana), WaveAccountStore(file, TestCipher.sameKey).load())
    } finally { folder.deleteRecursively() }
  }

  @Test fun `a file that doesn't decrypt is signed out and goes`() {
    val folder = Files.createTempDirectory("wave-account").toFile()
    val file = folder.resolve("wave-account-session")
    try {
      WaveAccountStore(file, TestCipher()).save(signedIn)
      val bytes = file.readBytes()
      bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
      file.writeBytes(bytes)
      assertEquals(WaveSessionState.SignedOut, WaveAccountStore(file, TestCipher.sameKey).load())
      assertFalse(file.exists())
    } finally { folder.deleteRecursively() }
  }

  @Test fun `signing out deletes the file`() {
    val folder = Files.createTempDirectory("wave-account").toFile()
    val file = folder.resolve("wave-account-session")
    try {
      val store = WaveAccountStore(file, TestCipher())
      store.save(signedIn)
      assertTrue(file.exists())
      store.save(WaveSessionState.SignedOut)
      assertFalse(file.exists())
      assertEquals(WaveSessionState.SignedOut, store.load())
    } finally { folder.deleteRecursively() }
  }
}
